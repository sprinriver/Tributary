# AWS HealthOmics: the service role runs assume (read inputs, write outputs, logs). Workflows themselves are
# registered by pipeline administrators in the app (SPEC M4), not here.
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "work_bucket_arn" {
  description = "Pipeline output bucket."
  type        = string
}

variable "raw_bucket_arn" {
  description = "Raw data bucket."
  type        = string
}

variable "kms_key_arn" {
  description = "Deployment KMS key."
  type        = string
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["omics.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "omics" {
  name               = "${var.name}-healthomics-runs"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "omics" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${var.raw_bucket_arn}/*", "${var.work_bucket_arn}/*"]
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${var.work_bucket_arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [var.raw_bucket_arn, var.work_bucket_arn]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }
  statement {
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:log-group:/aws/omics/*"]
  }
  statement {
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = ["arn:aws:ecr:*:${data.aws_caller_identity.current.account_id}:repository/*"]
  }
}

resource "aws_iam_role_policy" "omics" {
  name   = "healthomics-runs"
  role   = aws_iam_role.omics.id
  policy = data.aws_iam_policy_document.omics.json
}

output "service_role_arn" {
  description = "Role HealthOmics runs assume."
  value       = aws_iam_role.omics.arn
}
