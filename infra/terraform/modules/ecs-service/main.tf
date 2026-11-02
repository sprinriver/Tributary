# One Fargate service: task definition, service (Service Connect for internal calls), log group and security group.
variable "name" {
  description = "Service name (e.g. tributary-dev-api)."
  type        = string
}

variable "discovery_name" {
  description = "Service Connect name other tasks use (api, query, compute)."
  type        = string
}

variable "cluster_arn" {
  description = "ECS cluster."
  type        = string
}

variable "namespace_arn" {
  description = "Service Connect (Cloud Map HTTP) namespace."
  type        = string
}

variable "image" {
  description = "Container image (ECR URI with an immutable tag)."
  type        = string
}

variable "command" {
  description = "Container command (null keeps the image default)."
  type        = list(string)
  default     = null
}

variable "port" {
  description = "Container port."
  type        = number
}

variable "cpu" {
  description = "Task CPU units (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Task memory (MiB)."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of tasks."
  type        = number
  default     = 1
}

variable "arm64" {
  description = "Run on Graviton (ARM64)."
  type        = bool
  default     = true
}

variable "environment" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variables from Secrets Manager: name => secret ARN (optionally ARN:json-key::)."
  type        = map(string)
  default     = {}
}

variable "execution_role_arn" {
  description = "Task execution role."
  type        = string
}

variable "task_role_arn" {
  description = "Task role."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets."
  type        = list(string)
}

variable "ingress_security_group_ids" {
  description = "Security groups allowed to reach the container port."
  type        = list(string)
  default     = []
}

variable "target_group_arn" {
  description = "ALB target group (null for internal-only services)."
  type        = string
  default     = null
}

variable "kms_key_arn" {
  description = "KMS key for the log group."
  type        = string
}

variable "log_retention_days" {
  description = "Log retention (days)."
  type        = number
  default     = 365
}

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
}

resource "aws_security_group" "this" {
  name        = var.name
  description = "${var.name} tasks"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "this" {
  for_each                     = toset(var.ingress_security_group_ids)
  security_group_id            = aws_security_group.this.id
  description                  = "Container port from allowed callers"
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = var.port
  to_port                      = var.port
}

# Outbound HTTPS (AWS APIs, OLS, IdP) and private-network calls (database, other services).
resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.this.id
  description       = "HTTPS out"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "vpc" {
  security_group_id = aws_security_group.this.id
  description       = "Private network"
  cidr_ipv4         = "10.0.0.0/8"
  ip_protocol       = "tcp"
  from_port         = 0
  to_port           = 65535
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.arm64 ? "ARM64" : "X86_64"
  }
  # A writable scratch volume, so the root filesystem can be read-only.
  volume {
    name = "tmp"
  }
  container_definitions = jsonencode([
    merge(
      {
        name                   = "app"
        image                  = var.image
        essential              = true
        readonlyRootFilesystem = true
        portMappings           = [{ name = var.discovery_name, containerPort = var.port, protocol = "tcp", appProtocol = "http" }]
        environment            = [for k, v in var.environment : { name = k, value = v }]
        secrets                = [for k, v in var.secrets : { name = k, valueFrom = v }]
        mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.this.name
            awslogs-region        = data.aws_region.current.region
            awslogs-stream-prefix = "app"
          }
        }
      },
      var.command == null ? {} : { command = var.command },
    )
  ])
}

resource "aws_ecs_service" "this" {
  name                   = var.name
  cluster                = var.cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.this.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = var.namespace_arn
    service {
      port_name      = var.discovery_name
      discovery_name = var.discovery_name
      client_alias {
        port     = var.port
        dns_name = var.discovery_name
      }
    }
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [var.target_group_arn]
    content {
      target_group_arn = load_balancer.value
      container_name   = "app"
      container_port   = var.port
    }
  }
}

output "security_group_id" {
  description = "Security group of the tasks."
  value       = aws_security_group.this.id
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}
