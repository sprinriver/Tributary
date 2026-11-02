# AWS Batch for Nextflow: a Fargate Spot compute environment, a job queue, and the head-job definition. The head job
# runs Nextflow, which submits the pipeline's tasks to the same queue (nf-amazon / awsbatch executor).
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for jobs."
  type        = list(string)
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "max_vcpus" {
  description = "Ceiling on concurrent vCPUs."
  type        = number
  default     = 256
}

variable "head_image" {
  description = "Nextflow head-job image (pinned tag)."
  type        = string
  default     = "nextflow/nextflow:25.10.0"
}

variable "work_bucket_arn" {
  description = "Pipeline work/output bucket."
  type        = string
}

variable "raw_bucket_arn" {
  description = "Raw data bucket (pipeline inputs)."
  type        = string
}

variable "kms_key_arn" {
  description = "Deployment KMS key."
  type        = string
}

variable "execution_role_arn" {
  description = "Task execution role (image pull, logs)."
  type        = string
}

resource "aws_security_group" "jobs" {
  name        = "${var.name}-batch-jobs"
  description = "Batch jobs: outbound HTTPS only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_egress_rule" "jobs" {
  security_group_id = aws_security_group.jobs.id
  description       = "HTTPS out (AWS APIs, container registries)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_batch_compute_environment" "this" {
  name = "${var.name}-fargate-spot"
  type = "MANAGED"
  compute_resources {
    type               = "FARGATE_SPOT"
    max_vcpus          = var.max_vcpus
    subnets            = var.subnet_ids
    security_group_ids = [aws_security_group.jobs.id]
  }
}

resource "aws_batch_job_queue" "this" {
  name     = "${var.name}-pipelines"
  state    = "ENABLED"
  priority = 1
  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.this.arn
  }
}

data "aws_iam_policy_document" "job_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "job" {
  name               = "${var.name}-nextflow-head"
  assume_role_policy = data.aws_iam_policy_document.job_assume.json
}

data "aws_iam_policy_document" "job" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.work_bucket_arn}/*"]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${var.raw_bucket_arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [var.work_bucket_arn, var.raw_bucket_arn]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }
  statement {
    sid     = "NextflowSubmitsTasks"
    actions = ["batch:SubmitJob"]
    resources = [
      aws_batch_job_queue.this.arn,
      "arn:aws:batch:${local.region}:${local.account}:job-definition/nf-*",
    ]
  }
  statement {
    # Nextflow registers one job definition per task image, named nf-<image>.
    sid       = "NextflowTaskDefinitions"
    actions   = ["batch:RegisterJobDefinition"]
    resources = ["arn:aws:batch:${local.region}:${local.account}:job-definition/nf-*"]
  }
  statement {
    sid       = "NextflowStopsTasks"
    actions   = ["batch:TerminateJob"]
    resources = ["arn:aws:batch:${local.region}:${local.account}:job/*"]
  }
  statement {
    # These Describe/List actions do not support resource-level permissions.
    sid       = "NextflowReadsBatch"
    actions   = ["batch:DescribeJobs", "batch:DescribeJobDefinitions", "batch:DescribeJobQueues", "batch:ListJobs"]
    resources = ["*"]
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.job.arn, var.execution_role_arn]
  }
  statement {
    actions   = ["logs:GetLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${local.account}:log-group:/aws/batch/job:*"]
  }
}

resource "aws_iam_role_policy" "job" {
  name   = "nextflow-head"
  role   = aws_iam_role.job.id
  policy = data.aws_iam_policy_document.job.json
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

locals {
  region  = data.aws_region.current.region
  account = data.aws_caller_identity.current.account_id
}

resource "aws_batch_job_definition" "head" {
  name                  = "${var.name}-nextflow-head"
  type                  = "container"
  platform_capabilities = ["FARGATE"]
  container_properties = jsonencode({
    image            = var.head_image
    command          = ["nextflow", "-version"]
    jobRoleArn       = aws_iam_role.job.arn
    executionRoleArn = var.execution_role_arn
    resourceRequirements = [
      { type = "VCPU", value = "1" },
      { type = "MEMORY", value = "4096" },
    ]
    networkConfiguration         = { assignPublicIp = "DISABLED" }
    fargatePlatformConfiguration = { platformVersion = "LATEST" }
    readonlyRootFilesystem       = false
    logConfiguration = {
      logDriver = "awslogs"
      options   = { awslogs-region = data.aws_region.current.region, awslogs-stream-prefix = "nextflow" }
    }
  })
}

output "job_queue_arn" {
  description = "Job queue ARN."
  value       = aws_batch_job_queue.this.arn
}

output "job_definition_arn_prefix" {
  description = "Head job definition ARN without revision."
  value       = trimsuffix(aws_batch_job_definition.head.arn, ":${aws_batch_job_definition.head.revision}")
}

output "job_definition_name" {
  description = "Head job definition name."
  value       = aws_batch_job_definition.head.name
}

output "job_role_arn" {
  description = "Role of the Nextflow head job."
  value       = aws_iam_role.job.arn
}
