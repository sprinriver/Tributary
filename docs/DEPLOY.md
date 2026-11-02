# Deploying Tributary to AWS (customer account)

This runbook is for the customer's platform team. It installs Tributary in **your own AWS account** with the
Terraform in [`infra/terraform`](../infra/terraform), following ARCHITECTURE §12.
- **Planning** is automated: `terraform plan` runs in CI.
- **Applying** is always a deliberate human step. No tooling in this repository runs `terraform apply` or
  `destroy`.

For a quick public demo instead, see [`DEPLOY_HUGGINGFACE.md`](DEPLOY_HUGGINGFACE.md) (free) or
[`DEPLOY_RENDER.md`](DEPLOY_RENDER.md).

## What gets created (`envs/dev`)
| Area | Resources |
|---|---|
| Network | VPC across 2 AZs; public subnets (ALB, NAT) and private subnets (tasks, RDS, Batch); S3 gateway endpoint; VPC flow logs |
| Encryption | One customer-managed KMS key (rotation on), used for S3, RDS, logs, SQS, ECR and secrets |
| Storage | Buckets `raw`, `work`, `exports`, `warehouse`, `web` (versioned, KMS, private, access-logged), a log bucket, and an S3 Tables bucket |
| Database | RDS Postgres 17 (gp3, encrypted, TLS enforced, 14-day backups, deletion protection, Performance Insights). RDS keeps the master password in Secrets Manager. |
| Compute | ECS Fargate (Graviton): `api` ×2 behind the ALB, `query` (2 vCPU / 8 GB), `compute`. Internal calls use Service Connect (`query:3100`, `compute:8000`). Read-only root filesystems. |
| Edge | CloudFront serves the SPA from the `web` bucket (Origin Access Control) and sends `/api/*` to the ALB, with the prefix removed. The ALB accepts only CloudFront's origin-facing addresses, over HTTPS. |
| Pipelines | AWS Batch (Fargate Spot), a job queue and the Nextflow head-job definition. A HealthOmics service role. EventBridge → SQS (with a DLQ) for run status. |
| Access | One IAM role per service, least privilege; the task execution role reads only the app's secrets |
| Images | ECR repositories `<name>/node` and `<name>/compute`: immutable tags, scan on push, KMS |

**Indicative cost** (one environment, us-east-1, before pipeline compute; ARCHITECTURE §12):

| Item | Approximate monthly cost |
|---|---|
| Fargate | ≈ $228 on Graviton |
| RDS `db.t4g.medium` | ≈ $47 single-AZ (≈ $94 Multi-AZ) |
| Networking | ≈ $32 |
| S3 Tables | ≈ $29 per TB |
| ALB, CloudWatch, Secrets Manager, KMS, CloudFront | ≈ $40–80 |
| **Total** | **≈ $375–465 a month** |

Check the [AWS pricing calculator](https://calculator.aws/) for your region.

## Tools
| Tool | Version | Used for |
|---|---|---|
| Terraform (or OpenTofu) | ≥ 1.10 | plan and apply (`required_version`; the S3 backend uses `use_lockfile`) |
| tflint | ≥ 0.50 | lint (`pnpm run infra:validate`) |
| checkov | 3.4.0 | security scan (`pnpm run infra:validate`) |
| AWS CLI v2 | current | certificates, the SPA upload, the migration task |
| Docker with buildx | current | images (CI does this) |

`pnpm run infra:validate` runs `terraform fmt`, `validate`, tflint and checkov, and never plans or applies. CI's
`infra` job runs it on every pull request. Each check skipped in `infra/terraform/.checkov.yaml` has its reason
written there.

## Prerequisites
1. **AWS account and region**, with a role you can apply Terraform with.
2. **State bucket:** an S3 bucket for Terraform state (versioned, encrypted). Locking uses S3 lock files; no
   DynamoDB table is needed.
3. **Domain** for the app, for example `tributary.example.com`, in a DNS zone you control.
4. **Two ACM certificates:**
   - **For CloudFront:** for the domain, in **us-east-1**.
   - **For the ALB:** in **your region**. It can be for the same name, or `*.example.com`; CloudFront connects to the
     ALB by its AWS name over HTTPS, so a wildcard on your domain is fine.
5. **An OIDC client in your identity provider** (Okta, Entra ID, Auth0, Keycloak, …):
   - **Redirect URI:** `https://<domain>/api/v1/auth/callback`
   - **Post-logout redirect:** `https://<domain>/`
   - **Groups claim:** included in the ID token; the default claim name is `groups`.
   - Note the issuer URL, client id and client secret.
6. **Group mapping:** decide which IdP groups map to which roles (`auth_group_role_map`; see the README →
   Configuration).

## Variables (`infra/terraform/envs/dev/terraform.tfvars`)
Copy `terraform.tfvars.example` to `terraform.tfvars`; that file is git-ignored.

| Variable | Example | Notes |
|---|---|---|
| `region` | `eu-west-2` | |
| `name` | `acme-tributary-dev` | Prefix for everything; bucket names must be globally unique |
| `domain_name` | `tributary-dev.example.com` | The address users open |
| `cloudfront_certificate_arn` | `arn:aws:acm:us-east-1:…` | us-east-1 |
| `alb_certificate_arn` | `arn:aws:acm:eu-west-2:…` | your region |
| `image_tag` | git SHA | CI pushes `<sha>` tags; pass it with `-var image_tag=…` |
| `oidc_issuer`, `oidc_client_id` | | from your IdP |
| `auth_group_role_map` | JSON | IdP groups → roles |
| `db_instance_class`, `db_multi_az` | `db.t4g.medium`, `false` | use Multi-AZ in production |
| `api_desired_count` | `2` | |
| `omics_workflow_id` | empty | set to switch on the HealthOmics runner |

## Plan (automated or local)
- **CI** (`.github/workflows/aws.yml`): set these repository variables, then the workflow builds and pushes the
  images, runs `terraform plan`, and uploads the plan as an artifact.
  - `AWS_REGION`
  - `AWS_PLAN_ROLE_ARN` (an OIDC-assumable role that can push to ECR and read state)
  - `TF_STATE_BUCKET`
  - `TRIBUTARY_NAME` (= `name`)
  - `TF_VARS_DEV` (the tfvars content without `image_tag`)
- **Locally:**

  ```sh
  cd infra/terraform/envs/dev
  terraform init -backend-config="bucket=<state-bucket>" -backend-config="key=tributary/dev.tfstate" \
    -backend-config="region=<region>" -backend-config="use_lockfile=true" -backend-config="encrypt=true"
  terraform plan -var image_tag=<git-sha> -out=tfplan
  ```

Read the plan, especially every `destroy` or `replace` line.

## Apply (a human, outside any automation)
1. **Apply:** `terraform apply tfplan`, from a workstation or pipeline the platform team controls.
2. **OIDC client secret:** put its value into the secret named in the `oidc_client_secret_name` output:

   ```sh
   aws secretsmanager put-secret-value --secret-id <name>/oidc-client-secret --secret-string '<client secret>'
   ```

3. **DNS:** point the domain at the `cloudfront_domain` output, with an alias (Route 53) or a CNAME.
4. **Images:** CI pushes them for every commit. To push by hand, use the `ecr_repositories` output:

   ```sh
   docker buildx build --platform linux/arm64 -f deploy/render/node.Dockerfile -t <ecr-node>:<sha> --push .
   docker buildx build --platform linux/arm64 -f apps/compute/Dockerfile -t <ecr-compute>:<sha> --push .
   ```

5. **Migrations:** run them once, as a one-off task with the API task definition. The `migrate_command` output
   shows the command; add the private subnets and the API security group in `--network-configuration`.
6. **Buckets:** run `node apps/api/scripts/setup-storage.ts` the same way. It is idempotent and sets the upload CORS
   (Terraform also sets it).
7. **Upload the SPA:**

   ```sh
   pnpm run bootstrap && pnpm --dir apps/web run build
   aws s3 sync apps/web/dist s3://<web_bucket output>/ --delete
   aws cloudfront create-invalidation --distribution-id <id> --paths '/*'
   ```

8. **Restart the services:** `aws ecs update-service --cluster <name> --service <name>-api --force-new-deployment`
   (and `-query`, `-compute`).
9. **Verify:**
   - `https://<domain>/api/healthz` returns `ok`.
   - Sign in through your IdP; your group mapping decides your roles.
   - As a system admin, **Admin → Health** shows every dependency OK, with AWS Batch "Configured".

## Updating
1. **Images and plan:** merge to `main`. CI builds images tagged with the commit SHA and plans with that
   `image_tag`.
2. **Apply:** apply the reviewed plan. ECS rolls the services; the deployment circuit breaker rolls back on
   failure.
3. **Migrations:** run them as above before the new API takes traffic. Migrations are additive (CLAUDE.md: never
   edit a committed migration).
4. **SPA:** upload it and invalidate CloudFront.

## Rollback
- **Application:**
  - Plan and apply with the previous `image_tag`. Tags are immutable, so the old images are still in ECR.
  - Or roll an ECS service back to its previous task-definition revision.
- **Database:**
  - Migrations are forward-only. To undo data changes, restore an RDS automated backup (point-in-time restore) to
    a new instance.
  - Then point `DATABASE_HOST` at it: plan and apply with the new address, or rename the instances.
  - See [`RUNBOOK.md`](RUNBOOK.md) → Restore.
- **Infrastructure:**
  - `terraform plan` from the previous commit shows the way back. Review it before applying.
  - RDS, the ALB and the KMS key are deletion-protected or have deletion windows, so a mistaken destroy cannot
    remove them immediately.
- **Configuration only** (a secret, the group map): change it and force a new deployment of `api`.

## Production notes
- **Environments:**
  - Create `envs/prod` from `envs/dev` in your own repository or branch. It is created and applied by people only.
  - Use `db_multi_az = true`, a larger `db_instance_class`, and `api_desired_count ≥ 2`.
- **Database TLS:** `DATABASE_SSLMODE` is `no-verify` in dev, which encrypts but does not check the certificate.
  For production, add the RDS CA bundle to the image and use `verify-full`.
- **WAF:** attach one through the `cloudfront` module's `web_acl_arn`.
- **Alarms:** see [`RUNBOOK.md`](RUNBOOK.md) → Alarms.
