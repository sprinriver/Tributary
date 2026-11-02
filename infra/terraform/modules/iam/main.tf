# Task roles per service, least privilege, plus a shared task-execution role (image pull, logs, secrets).
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "kms_key_arn" {
  description = "Deployment KMS key."
  type        = string
}

variable "bucket_arns" {
  description = "Bucket ARNs by purpose (raw, work, exports, warehouse, web)."
  type        = map(string)
}

variable "secret_arns" {
  description = "Secrets the tasks receive as environment variables."
  type        = list(string)
}

variable "run_events_queue_arn" {
  description = "SQS queue with pipeline status events (the API consumes it)."
  type        = string
}

variable "batch_job_queue_arn" {
  description = "Batch job queue the API submits pipeline runs to."
  type        = string
}

variable "batch_job_definition_arn_prefix" {
  description = "Batch job definition ARN prefix (any revision) for the Nextflow head job."
  type        = string
}

variable "omics_service_role_arn" {
  description = "Role HealthOmics runs assume (the API passes it)."
  type        = string
}

variable "batch_job_role_arn" {
  description = "Role the Nextflow head job assumes (the API passes it)."
  type        = string
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

locals {
  region  = data.aws_region.current.region
  account = data.aws_caller_identity.current.account_id
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- execution role ---------------------------------------------------------------------------------------------
resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_arns
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# --- API ----------------------------------------------------------------------------------------------------------
resource "aws_iam_role" "api" {
  name               = "${var.name}-api"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    sid     = "Objects"
    actions = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = [
      "${var.bucket_arns["raw"]}/*", "${var.bucket_arns["work"]}/*",
      "${var.bucket_arns["exports"]}/*", "${var.bucket_arns["warehouse"]}/*",
    ]
  }
  statement {
    sid     = "Buckets"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [
      var.bucket_arns["raw"], var.bucket_arns["work"], var.bucket_arns["exports"], var.bucket_arns["warehouse"],
    ]
  }
  statement {
    sid       = "Key"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }
  statement {
    sid       = "RunEvents"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.run_events_queue_arn]
  }
  statement {
    sid       = "BatchSubmit"
    actions   = ["batch:SubmitJob"]
    resources = [var.batch_job_queue_arn, "${var.batch_job_definition_arn_prefix}*"]
  }
  statement {
    # DescribeJobs and ListJobs do not support resource-level permissions.
    sid       = "BatchRead"
    actions   = ["batch:DescribeJobs", "batch:ListJobs"]
    resources = ["*"]
  }
  statement {
    sid       = "BatchCancel"
    actions   = ["batch:TerminateJob"]
    resources = ["arn:aws:batch:${local.region}:${local.account}:job/*"]
  }
  statement {
    sid     = "Omics"
    actions = ["omics:StartRun", "omics:GetRun", "omics:CancelRun", "omics:ListRunTasks", "omics:GetRunTask"]
    resources = [
      "arn:aws:omics:${local.region}:${local.account}:workflow/*",
      "arn:aws:omics:${local.region}:${local.account}:run/*",
    ]
  }
  statement {
    sid       = "PassRunRoles"
    actions   = ["iam:PassRole"]
    resources = [var.omics_service_role_arn, var.batch_job_role_arn]
  }
  statement {
    sid     = "RunLogs"
    actions = ["logs:GetLogEvents", "logs:FilterLogEvents"]
    resources = [
      "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/batch/job:*",
      "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/omics/WorkflowLog:*",
    ]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# --- query service: reads raw and warehouse, writes releases and exports ------------------------------------------------
resource "aws_iam_role" "query" {
  name               = "${var.name}-query"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "query" {
  statement {
    actions = ["s3:GetObject", "s3:PutObject"]
    resources = [
      "${var.bucket_arns["raw"]}/*", "${var.bucket_arns["warehouse"]}/*", "${var.bucket_arns["work"]}/*",
    ]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [var.bucket_arns["raw"], var.bucket_arns["warehouse"], var.bucket_arns["work"]]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "query" {
  name   = "query"
  role   = aws_iam_role.query.id
  policy = data.aws_iam_policy_document.query.json
}

# --- compute: no AWS access ---------------------------------------------------------------------------------------
resource "aws_iam_role" "compute" {
  name               = "${var.name}-compute"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

output "execution_role_arn" {
  description = "ECS task execution role."
  value       = aws_iam_role.execution.arn
}

output "task_role_arns" {
  description = "Task roles by service (api, query, compute)."
  value       = { api = aws_iam_role.api.arn, query = aws_iam_role.query.arn, compute = aws_iam_role.compute.arn }
}
