# Public ALB in front of the API, reachable only from CloudFront (origin-facing prefix list), HTTPS only.
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "subnet_ids" {
  description = "Public subnets."
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate (in this region) for the ALB's HTTPS listener."
  type        = string
}

variable "logs_bucket" {
  description = "Bucket for ALB access logs."
  type        = string
}

variable "target_port" {
  description = "API container port."
  type        = number
  default     = 3000
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "HTTPS from CloudFront only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from CloudFront"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "targets" {
  security_group_id = aws_security_group.alb.id
  description       = "To API tasks"
  cidr_ipv4         = "10.0.0.0/8"
  ip_protocol       = "tcp"
  from_port         = var.target_port
  to_port           = var.target_port
}

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = var.subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  access_logs {
    bucket  = var.logs_bucket
    prefix  = "alb"
    enabled = true
  }
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  port        = var.target_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

output "dns_name" {
  description = "ALB DNS name (CloudFront's API origin)."
  value       = aws_lb.this.dns_name
}

output "security_group_id" {
  description = "ALB security group (allowed into the API tasks)."
  value       = aws_security_group.alb.id
}

output "target_group_arn" {
  description = "API target group."
  value       = aws_lb_target_group.api.arn
}
