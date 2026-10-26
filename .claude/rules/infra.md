---
paths:
  - "infra/**"
---
# Infrastructure rules
- Never run terraform/tofu apply, destroy, import or state edits. Allowed: fmt, validate, tflint, checkov, and
  plan only with an AWS profile the user names in the session.
- Customer-managed KMS keys everywhere; no public buckets; S3 Versioning on raw and work buckets;
  least-privilege IAM per service; tags `app=tributary`, `env`, `owner` on every resource.
- Modules are reusable and region-agnostic. HealthOmics resources sit behind a flag (only 8 regions have it).
- No Iceberg tags or branches on S3 Tables (they disable snapshot management); set table retention explicitly.
