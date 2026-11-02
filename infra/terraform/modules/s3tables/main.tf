# S3 Tables (managed Iceberg) bucket for dataset releases at scale (ADR 0017; Parquet in the warehouse bucket
# remains the default). Encryption defaults to SSE-S3; namespaces are created by the query service.
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

resource "aws_s3tables_table_bucket" "this" {
  name = "${var.name}-tables"
}

output "table_bucket_arn" {
  description = "ARN of the S3 Tables bucket."
  value       = aws_s3tables_table_bucket.this.arn
}
