# Postgres 17 (pgvector is available on RDS 17) in private subnets: encrypted, backed up, deletion-protected.
# The master password is generated and kept in Secrets Manager by RDS itself.
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the database."
  type        = list(string)
}

variable "client_security_group_ids" {
  description = "Security groups allowed to connect (API and query tasks)."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key for storage, Performance Insights and the master secret."
  type        = string
}

variable "instance_class" {
  description = "Instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  description = "Initial storage (GB); grows automatically up to max_allocated_storage_gb."
  type        = number
  default     = 50
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling (GB)."
  type        = number
  default     = 500
}

variable "multi_az" {
  description = "Standby in a second AZ (production)."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Automated backup retention (days)."
  type        = number
  default     = 14
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres from the application tasks only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "db" {
  for_each                     = toset(var.client_security_group_ids)
  security_group_id            = aws_security_group.db.id
  description                  = "Postgres from application tasks"
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg17"
  family = "postgres17"
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  parameter {
    name  = "log_statement"
    value = "ddl"
  }
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  name               = "${var.name}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  role       = aws_iam_role.monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  identifier                            = var.name
  engine                                = "postgres"
  engine_version                        = "17"
  instance_class                        = var.instance_class
  allocated_storage                     = var.allocated_storage_gb
  max_allocated_storage                 = var.max_allocated_storage_gb
  storage_type                          = "gp3"
  storage_encrypted                     = true
  kms_key_id                            = var.kms_key_arn
  db_name                               = "tributary"
  username                              = "tributary"
  manage_master_user_password           = true
  master_user_secret_kms_key_id         = var.kms_key_arn
  db_subnet_group_name                  = aws_db_subnet_group.this.name
  vpc_security_group_ids                = [aws_security_group.db.id]
  parameter_group_name                  = aws_db_parameter_group.this.name
  publicly_accessible                   = false
  multi_az                              = var.multi_az
  backup_retention_period               = var.backup_retention_days
  copy_tags_to_snapshot                 = true
  deletion_protection                   = true
  skip_final_snapshot                   = false
  final_snapshot_identifier             = "${var.name}-final"
  auto_minor_version_upgrade            = true
  iam_database_authentication_enabled   = true
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_arn
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.monitoring.arn
}

output "address" {
  description = "Database host name."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Database port."
  value       = aws_db_instance.this.port
}

output "master_secret_arn" {
  description = "Secrets Manager secret holding the master credentials (managed by RDS)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}
