# Data buckets (raw uploads, pipeline work, exports, dataset releases, the SPA) plus an access-log bucket.
# Every data bucket is private, versioned, KMS-encrypted, and logs access to the log bucket.
variable "name" {
  description = "Deployment name prefix (bucket names are <name>-<purpose>)."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for bucket encryption."
  type        = string
}

variable "cors_origins" {
  description = "Origins allowed to upload to the raw bucket with presigned URLs (the web address)."
  type        = list(string)
}

variable "noncurrent_version_days" {
  description = "Days to keep noncurrent object versions."
  type        = number
  default     = 90
}

locals {
  buckets = toset(["raw", "work", "exports", "warehouse", "web"])
}

# Access logs: ALB and S3 server access logging need SSE-S3 (they cannot write with a customer KMS key).
resource "aws_s3_bucket" "logs" {
  bucket = "${var.name}-logs"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_caller_identity" "current" {}

# Log delivery: ALB access logs and S3 server access logs write here (CloudFront uses the bucket ACL).
data "aws_iam_policy_document" "logs" {
  statement {
    sid       = "AlbLogDelivery"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }
  }
  statement {
    sid       = "S3ServerAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/s3/*"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.logs.json
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = 365
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = "${var.name}-${each.key}"
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.buckets
  bucket                  = aws_s3_bucket.this[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_logging" "this" {
  for_each      = local.buckets
  bucket        = aws_s3_bucket.this[each.key].id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3/${each.key}/"
}

# Storage classes per role are applied by the app's lifecycle policies (SPEC M3); this keeps old versions bounded.
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    id     = "noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
  dynamic "rule" {
    for_each = each.key == "exports" ? [1] : []
    content {
      id     = "expire-exports"
      status = "Enabled"
      filter {}
      expiration {
        days = 30
      }
      abort_incomplete_multipart_upload {
        days_after_initiation = 7
      }
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "raw" {
  bucket = aws_s3_bucket.this["raw"].id
  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.cors_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

output "bucket_names" {
  description = "Bucket names by purpose (raw, work, exports, warehouse, web)."
  value       = { for k, b in aws_s3_bucket.this : k => b.bucket }
}

output "bucket_arns" {
  description = "Bucket ARNs by purpose."
  value       = { for k, b in aws_s3_bucket.this : k => b.arn }
}

output "web_bucket_regional_domain" {
  description = "Regional domain of the SPA bucket (CloudFront origin)."
  value       = aws_s3_bucket.this["web"].bucket_regional_domain_name
}

output "logs_bucket" {
  description = "Access-log bucket name."
  value       = aws_s3_bucket.logs.bucket
}

output "logs_bucket_domain" {
  description = "Access-log bucket domain (CloudFront logging)."
  value       = aws_s3_bucket.logs.bucket_domain_name
}
