# Pipeline status: AWS Batch and HealthOmics state changes → EventBridge → SQS (with a dead-letter queue).
# The API consumes the queue (RUN_EVENTS_QUEUE_URL); polling fills any gaps (SPEC M4).
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for the queues."
  type        = string
}

variable "batch_job_queue_arn" {
  description = "Only events from this Batch job queue are forwarded."
  type        = string
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-run-events-dlq"
  kms_master_key_id         = var.kms_key_arn
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "this" {
  name                      = "${var.name}-run-events"
  kms_master_key_id         = var.kms_key_arn
  message_retention_seconds = 345600
  redrive_policy            = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 5 })
}

resource "aws_cloudwatch_event_rule" "batch" {
  name        = "${var.name}-batch-job-state"
  description = "Batch job state changes for Tributary runs"
  event_pattern = jsonencode({
    source        = ["aws.batch"]
    "detail-type" = ["Batch Job State Change"]
    detail        = { jobQueue = [var.batch_job_queue_arn] }
  })
}

resource "aws_cloudwatch_event_rule" "omics" {
  name        = "${var.name}-omics-run-status"
  description = "HealthOmics run status changes"
  event_pattern = jsonencode({
    source        = ["aws.omics"]
    "detail-type" = ["Run Status Change"]
  })
}

resource "aws_cloudwatch_event_target" "batch" {
  rule = aws_cloudwatch_event_rule.batch.name
  arn  = aws_sqs_queue.this.arn
}

resource "aws_cloudwatch_event_target" "omics" {
  rule = aws_cloudwatch_event_rule.omics.name
  arn  = aws_sqs_queue.this.arn
}

data "aws_iam_policy_document" "queue" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.this.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.batch.arn, aws_cloudwatch_event_rule.omics.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "this" {
  queue_url = aws_sqs_queue.this.id
  policy    = data.aws_iam_policy_document.queue.json
}

output "queue_url" {
  description = "Run events queue URL (RUN_EVENTS_QUEUE_URL)."
  value       = aws_sqs_queue.this.id
}

output "queue_arn" {
  description = "Run events queue ARN."
  value       = aws_sqs_queue.this.arn
}
