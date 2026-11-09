# Tributary in one AWS account and region (ARCHITECTURE §12). Plan-only from tooling: `terraform apply` is a human
# step (docs/DEPLOY.md). The customer's IdP provides sign-in (no Keycloak on AWS).
locals {
  tenant_id          = "00000000-0000-7000-8000-000000000001"
  app_url            = "https://${var.domain_name}"
  availability_zones = length(var.availability_zones) > 0 ? var.availability_zones : ["${var.region}a", "${var.region}b"]
  api_origin_domain  = var.api_origin_domain != "" ? var.api_origin_domain : "origin.${var.domain_name}"
}

module "kms" {
  source = "../../modules/kms"
  name   = var.name
}

module "network" {
  source             = "../../modules/network"
  name               = var.name
  availability_zones = local.availability_zones
  kms_key_arn        = module.kms.key_arn
}

module "s3" {
  source       = "../../modules/s3"
  name         = var.name
  kms_key_arn  = module.kms.key_arn
  cors_origins = [local.app_url]
}

module "s3tables" {
  source      = "../../modules/s3tables"
  name        = var.name
  kms_key_arn = module.kms.key_arn
}

# --- container images --------------------------------------------------------------------------------------------
resource "aws_ecr_repository" "this" {
  for_each             = toset(["node", "compute"])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.kms.key_arn
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    # Only untagged layers expire: tagged images (git SHAs) stay, so any deployed or previous tag can be pulled.
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }
      action       = { type = "expire" }
    }]
  })
}

# --- secrets -----------------------------------------------------------------------------------------------------
resource "random_password" "cookie" {
  length  = 64
  special = false
}

resource "random_password" "query_token" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  for_each   = toset(["cookie-secret", "query-internal-token", "oidc-client-secret"])
  name       = "${var.name}/${each.key}"
  kms_key_id = module.kms.key_arn
}

resource "aws_secretsmanager_secret_version" "cookie" {
  secret_id     = aws_secretsmanager_secret.app["cookie-secret"].id
  secret_string = random_password.cookie.result
}

resource "aws_secretsmanager_secret_version" "query_token" {
  secret_id     = aws_secretsmanager_secret.app["query-internal-token"].id
  secret_string = random_password.query_token.result
}
# The OIDC client secret comes from the customer's IdP: set its value in Secrets Manager after apply (DEPLOY.md).

# --- pipelines ---------------------------------------------------------------------------------------------------
module "batch" {
  source             = "../../modules/batch"
  name               = var.name
  vpc_id             = module.network.vpc_id
  subnet_ids         = module.network.private_subnet_ids
  work_bucket_arn    = module.s3.bucket_arns["work"]
  raw_bucket_arn     = module.s3.bucket_arns["raw"]
  kms_key_arn        = module.kms.key_arn
  execution_role_arn = module.iam.execution_role_arn
}

module "healthomics" {
  count           = var.enable_healthomics ? 1 : 0
  source          = "../../modules/healthomics"
  name            = var.name
  work_bucket_arn = module.s3.bucket_arns["work"]
  raw_bucket_arn  = module.s3.bucket_arns["raw"]
  kms_key_arn     = module.kms.key_arn
}

module "run_events" {
  source              = "../../modules/eventbridge-sqs"
  name                = var.name
  kms_key_arn         = module.kms.key_arn
  batch_job_queue_arn = module.batch.job_queue_arn
  enable_healthomics  = var.enable_healthomics
}

module "iam" {
  source                          = "../../modules/iam"
  name                            = var.name
  kms_key_arn                     = module.kms.key_arn
  bucket_arns                     = module.s3.bucket_arns
  secret_arns                     = concat([for s in aws_secretsmanager_secret.app : s.arn], [module.rds.master_secret_arn])
  run_events_queue_arn            = module.run_events.queue_arn
  batch_job_queue_arn             = module.batch.job_queue_arn
  batch_job_definition_arn_prefix = module.batch.job_definition_arn_prefix
  enable_healthomics              = var.enable_healthomics
  omics_service_role_arn          = var.enable_healthomics ? module.healthomics[0].service_role_arn : ""
  batch_job_role_arn              = module.batch.job_role_arn
}

# --- database ----------------------------------------------------------------------------------------------------
module "rds" {
  source                    = "../../modules/rds"
  name                      = var.name
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.private_subnet_ids
  client_security_group_ids = [module.api.security_group_id, module.query.security_group_id]
  kms_key_arn               = module.kms.key_arn
  instance_class            = var.db_instance_class
  multi_az                  = var.db_multi_az
}

# --- services ----------------------------------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_service_discovery_http_namespace" "this" {
  name        = var.name
  description = "Service Connect namespace for ${var.name}"
}

module "alb" {
  source          = "../../modules/alb"
  name            = var.name
  vpc_id          = module.network.vpc_id
  subnet_ids      = module.network.public_subnet_ids
  certificate_arn = var.alb_certificate_arn
  logs_bucket     = module.s3.logs_bucket
}

locals {
  node_image    = "${aws_ecr_repository.this["node"].repository_url}:${var.image_tag}"
  compute_image = "${aws_ecr_repository.this["compute"].repository_url}:${var.image_tag}"
  s3_env = {
    AWS_REGION          = var.region
    S3_REGION           = var.region
    S3_RAW_BUCKET       = module.s3.bucket_names["raw"]
    S3_WAREHOUSE_BUCKET = module.s3.bucket_names["warehouse"]
    S3_WORK_BUCKET      = module.s3.bucket_names["work"]
  }
  db_env = {
    DATABASE_HOST = module.rds.address
    DATABASE_PORT = tostring(module.rds.port)
    DATABASE_USER = "tributary"
    DATABASE_NAME = "tributary"
    # RDS enforces TLS (rds.force_ssl). no-verify encrypts without checking the RDS CA; mount the RDS CA bundle and
    # use verify-full for production (docs/DEPLOY.md).
    DATABASE_SSLMODE = "no-verify"
  }
  db_password = { DATABASE_PASSWORD = "${module.rds.master_secret_arn}:password::" }
  common = {
    execution_role_arn = module.iam.execution_role_arn
    cluster_arn        = aws_ecs_cluster.this.arn
    namespace_arn      = aws_service_discovery_http_namespace.this.arn
    vpc_id             = module.network.vpc_id
    subnet_ids         = module.network.private_subnet_ids
    kms_key_arn        = module.kms.key_arn
  }
}

module "api" {
  source                     = "../../modules/ecs-service"
  name                       = "${var.name}-api"
  discovery_name             = "api"
  image                      = local.node_image
  port                       = 3000
  cpu                        = 512
  memory                     = 1024
  desired_count              = var.api_desired_count
  task_role_arn              = module.iam.task_role_arns["api"]
  ingress_security_group_ids = [module.alb.security_group_id]
  target_group_arn           = module.alb.target_group_arn
  execution_role_arn         = local.common.execution_role_arn
  cluster_arn                = local.common.cluster_arn
  namespace_arn              = local.common.namespace_arn
  vpc_id                     = local.common.vpc_id
  subnet_ids                 = local.common.subnet_ids
  kms_key_arn                = local.common.kms_key_arn
  environment = merge(local.s3_env, local.db_env, {
    NODE_ENV             = "production"
    API_HOST             = "0.0.0.0"
    TRIBUTARY_TENANT_ID  = local.tenant_id
    PUBLIC_URL           = local.app_url
    OIDC_ISSUER          = var.oidc_issuer
    OIDC_CLIENT_ID       = var.oidc_client_id
    AUTH_GROUP_ROLE_MAP  = var.auth_group_role_map
    QUERY_HOSTPORT       = "query:3100"
    COMPUTE_HOSTPORT     = "compute:8000"
    RUN_EVENTS_QUEUE_URL = module.run_events.queue_url
    BATCH_JOB_QUEUE      = module.batch.job_queue_arn
    BATCH_JOB_DEFINITION = module.batch.job_definition_name
    OMICS_WORKFLOW_ID    = var.omics_workflow_id
    OMICS_ROLE_ARN       = var.enable_healthomics && var.omics_workflow_id != "" ? module.healthomics[0].service_role_arn : ""
  })
  secrets = merge(local.db_password, {
    COOKIE_SECRET        = aws_secretsmanager_secret.app["cookie-secret"].arn
    QUERY_INTERNAL_TOKEN = aws_secretsmanager_secret.app["query-internal-token"].arn
    OIDC_CLIENT_SECRET   = aws_secretsmanager_secret.app["oidc-client-secret"].arn
  })
}

module "query" {
  source                     = "../../modules/ecs-service"
  name                       = "${var.name}-query"
  discovery_name             = "query"
  image                      = local.node_image
  command                    = ["node", "apps/query/src/server.ts"]
  port                       = 3100
  cpu                        = 2048
  memory                     = 8192
  task_role_arn              = module.iam.task_role_arns["query"]
  ingress_security_group_ids = [module.api.security_group_id]
  execution_role_arn         = local.common.execution_role_arn
  cluster_arn                = local.common.cluster_arn
  namespace_arn              = local.common.namespace_arn
  vpc_id                     = local.common.vpc_id
  subnet_ids                 = local.common.subnet_ids
  kms_key_arn                = local.common.kms_key_arn
  environment = merge(local.s3_env, local.db_env, {
    NODE_ENV   = "production"
    QUERY_HOST = "0.0.0.0"
  })
  secrets = merge(local.db_password, {
    QUERY_INTERNAL_TOKEN = aws_secretsmanager_secret.app["query-internal-token"].arn
  })
}

module "compute" {
  source                     = "../../modules/ecs-service"
  name                       = "${var.name}-compute"
  discovery_name             = "compute"
  image                      = local.compute_image
  port                       = 8000
  cpu                        = 1024
  memory                     = 2048
  task_role_arn              = module.iam.task_role_arns["compute"]
  ingress_security_group_ids = [module.api.security_group_id]
  execution_role_arn         = local.common.execution_role_arn
  cluster_arn                = local.common.cluster_arn
  namespace_arn              = local.common.namespace_arn
  vpc_id                     = local.common.vpc_id
  subnet_ids                 = local.common.subnet_ids
  kms_key_arn                = local.common.kms_key_arn
}

module "cloudfront" {
  source                     = "../../modules/cloudfront"
  name                       = var.name
  web_bucket_name            = module.s3.bucket_names["web"]
  web_bucket_arn             = module.s3.bucket_arns["web"]
  web_bucket_regional_domain = module.s3.web_bucket_regional_domain
  api_origin_domain          = local.api_origin_domain
  aliases                    = [var.domain_name]
  certificate_arn            = var.cloudfront_certificate_arn
  logs_bucket_domain         = module.s3.logs_bucket_domain
  upload_origin              = module.s3.raw_bucket_origin
}
