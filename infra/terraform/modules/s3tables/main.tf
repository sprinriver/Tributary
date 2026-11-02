# S3 Tables (managed Iceberg) bucket for dataset releases at scale (ADR 0017; Parquet in the warehouse bucket
# remains the default). Encrypted with the deployment key; namespaces and per-table snapshot retention are set by the
# query service. No Iceberg tags or branches (they disable snapshot management).
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "kms_key_arn" {
  description = "Deployment KMS key (customer-managed)."
  type        = string
}

variable "unreferenced_days" {
  description = "Days before unreferenced data files are marked for deletion."
  type        = number
  default     = 3
}

variable "noncurrent_days" {
  description = "Days before files marked for deletion are deleted."
  type        = number
  default     = 10
}

resource "aws_s3tables_table_bucket" "this" {
  name = "${var.name}-tables"
  encryption_configuration {
    sse_algorithm = "aws:kms"
    kms_key_arn   = var.kms_key_arn
  }
  maintenance_configuration {
    iceberg_unreferenced_file_removal {
      status = "enabled"
      settings {
        unreferenced_days = var.unreferenced_days
        non_current_days  = var.noncurrent_days
      }
    }
  }
}

output "table_bucket_arn" {
  description = "ARN of the S3 Tables bucket."
  value       = aws_s3tables_table_bucket.this.arn
}
