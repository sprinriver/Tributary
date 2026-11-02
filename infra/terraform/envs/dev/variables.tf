variable "region" {
  description = "AWS region."
  type        = string
}

variable "availability_zones" {
  description = "Availability zones (2 or 3). Empty means <region>a and <region>b."
  type        = list(string)
  default     = []
}

variable "environment" {
  description = "Environment name (dev, staging)."
  type        = string
  default     = "dev"
}

variable "owner" {
  description = "Team that owns the deployment (the `owner` tag on every resource)."
  type        = string
}

variable "api_origin_domain" {
  description = "DNS name CloudFront uses for the ALB; the ALB certificate must cover it. Empty: origin.<domain_name>."
  type        = string
  default     = ""
}

variable "enable_healthomics" {
  description = "Create the HealthOmics role and run-status rule (HealthOmics is available in a few regions only)."
  type        = bool
  default     = false
}

variable "name" {
  description = "Resource name prefix; must be globally unique for bucket names (e.g. acme-tributary-dev)."
  type        = string
}

variable "domain_name" {
  description = "Public address of the app (CloudFront alias), e.g. tributary.example.com."
  type        = string
}

variable "cloudfront_certificate_arn" {
  description = "ACM certificate in us-east-1 for domain_name."
  type        = string
}

variable "alb_certificate_arn" {
  description = "ACM certificate in this region for the ALB (CloudFront → ALB is HTTPS)."
  type        = string
}

variable "image_tag" {
  description = "Image tag to deploy (immutable; the release workflow pushes git-SHA tags)."
  type        = string
}

variable "oidc_issuer" {
  description = "Customer IdP issuer URL (OIDC)."
  type        = string
}

variable "oidc_client_id" {
  description = "OIDC client id registered for Tributary (redirect URI https://<domain_name>/api/v1/auth/callback)."
  type        = string
}

variable "auth_group_role_map" {
  description = "JSON list mapping IdP groups to roles (README → Configuration)."
  type        = string
  default     = "[]"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "RDS Multi-AZ standby."
  type        = bool
  default     = false
}

variable "api_desired_count" {
  description = "API tasks (two for availability)."
  type        = number
  default     = 2
}

variable "omics_workflow_id" {
  description = "HealthOmics workflow id to run (empty: HealthOmics runner off)."
  type        = string
  default     = ""
}
