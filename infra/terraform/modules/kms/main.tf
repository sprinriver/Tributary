# One customer-managed key for the deployment: S3, RDS, logs, SQS, secrets and ECR use it.
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

variable "name" {
  description = "Deployment name, used as a prefix (e.g. tributary-dev)."
  type        = string
}

variable "deletion_window_days" {
  description = "Days before a scheduled key deletion takes effect."
  type        = number
  default     = 30
}

data "aws_iam_policy_document" "key" {
  statement {
    sid       = "AccountAdministers"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid = "CloudWatchLogs"
    actions = [
      "kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*",
    ]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${data.aws_region.current.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:*"]
    }
  }
  statement {
    sid       = "EventBridgeToSqs"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "this" {
  description             = "${var.name} data key"
  enable_key_rotation     = true
  deletion_window_in_days = var.deletion_window_days
  policy                  = data.aws_iam_policy_document.key.json
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.this.key_id
}

output "key_arn" {
  description = "ARN of the deployment key."
  value       = aws_kms_key.this.arn
}
