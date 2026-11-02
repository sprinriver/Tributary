output "cloudfront_domain" {
  description = "Point domain_name (CNAME/alias) here."
  value       = module.cloudfront.domain_name
}

output "ecr_repositories" {
  description = "Push images here (node: API and query; compute)."
  value       = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "web_bucket" {
  description = "Upload the built SPA (apps/web/dist) here."
  value       = module.s3.bucket_names["web"]
}

output "oidc_client_secret_name" {
  description = "Set the IdP client secret's value in this Secrets Manager secret after apply."
  value       = aws_secretsmanager_secret.app["oidc-client-secret"].name
}

output "migrate_command" {
  description = "Run migrations as a one-off task (docs/DEPLOY.md)."
  value       = "aws ecs run-task --cluster ${aws_ecs_cluster.this.name} --task-definition ${var.name}-api --launch-type FARGATE --overrides '{\"containerOverrides\":[{\"name\":\"app\",\"command\":[\"node\",\"packages/db/scripts/migrate.ts\"]}]}' ..."
}

output "alb_dns_name" {
  description = "Point the API origin name (origin.<domain> or api_origin_domain) at this with a CNAME or alias."
  value       = module.alb.dns_name
}

output "api_origin_domain" {
  description = "The name CloudFront uses for the API origin; the ALB certificate must cover it."
  value       = local.api_origin_domain
}
