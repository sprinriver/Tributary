# Tributary security whitepaper

For security reviewers, IT and procurement teams assessing Tributary (v2.1, November 2026).
Each statement points to where it is implemented, so a reviewer can check it. The last section lists what is not
built yet.

## 1. Deployment model: your account, your data

Tributary is installed in the customer's own AWS account from the Terraform modules in `infra/terraform`.
- **Where data lives:** experiment data, files, the database and logs stay in that account. We run no shared
  multi-tenant service and hold no copy of customer data.
- **Applying the infrastructure:** the customer's platform team, or we with their approval, apply it. No tooling in
  the repository runs `terraform apply` (`docs/DEPLOY.md`).
- **Network:**
  - a VPC across two availability zones, with private subnets for the services and the database;
  - an Application Load Balancer and CloudFront in front;
  - S3 buckets with all public access blocked.
- **Outbound connections** happen only for features the customer turns on:
  - the identity provider;
  - email (Amazon SES or SMTP);
  - Slack or Teams webhooks;
  - an AI provider;
  - AlphaFold DB for protein models.

  In production, outbound webhook and notification addresses are checked: private and reserved IP ranges are
  refused (`apps/api/src/webhooks/address.ts`), and redirects are not followed.

## 2. Encryption

- **At rest:** customer-managed KMS keys with automatic rotation (`modules/kms`) encrypt:
  - RDS PostgreSQL storage, including Performance Insights and the managed master-user secret (`modules/rds`);
  - S3 buckets (versioned) and S3 Tables (`modules/s3`, `modules/s3tables`).
- **In transit:**
  - The load balancer accepts TLS 1.2 and 1.3 only (`ELBSecurityPolicy-TLS13-1-2-2021-06`, `modules/alb`).
  - CloudFront sends HSTS (one year, subdomains, preload).
  - The web app's bucket is reachable only through CloudFront (origin access control, SigV4).
- **Secrets:** AWS Secrets Manager (RDS credentials rotate) and SSM Parameter Store. Production refuses to start
  without its required secrets (`apps/api/src/config.ts`).

## 3. Identity and access

- **Single sign-on:**
  - OpenID Connect, authorization code flow with PKCE, against the customer's identity provider (Okta, Entra ID,
    Keycloak or others). Tributary stores no passwords.
  - Group claims map to roles.
- **Sessions:**
  - Sessions are kept on the server.
  - The browser holds an httpOnly cookie (Secure in production, SameSite=strict for the session). Only its SHA-256
    hash is stored.
  - Sessions expire after 12 hours by default (`SESSION_TTL_HOURS`).
  - Requests that change data need a CSRF token.
- **Re-authentication:** publishing a version and approving need a recent sign-in, and that sign-in is recorded in
  the audit row.
- **Roles:**
  - Each program has viewer, contributor and approver roles; system admins manage the installation.
  - Every request is authorised on the server per program (CASL abilities). The browser's copy of the rules only
    hides buttons; it is never trusted.
  - List queries are limited to the caller's programs before any SQL is compiled.
- **API tokens:**
  - Personal access tokens are scoped (`read`, `write`, or `scim` for provisioning only), expire, and are stored as
    hashes.
  - A provisioning token reads nothing else: not the API, not the MCP endpoint.
- **SCIM 2.0 provisioning:**
  - The identity provider creates, updates and deactivates users and groups.
  - Deactivation ends access at once: sessions and tokens stop working on the next request (feature SCIM-04).
- **Least privilege in the database:**
  - The application's PostgreSQL role has no DELETE or TRUNCATE on any table; records are soft-deleted.
  - On the audit log it has INSERT and SELECT only (`packages/db/migrations/0006_app_role`).

## 4. Data integrity and audit trail

- **Audit log:** every change and every export writes an audit row. The row holds:
  - who did it and when (UTC);
  - the action and the entity;
  - the values before and after;
  - a reason, where a reason is required.
- **Audit log protection:** database triggers reject any UPDATE, DELETE or TRUNCATE of the audit log
  (`0005_integrity_triggers`), on top of the role's missing grants.
- **Immutability:** published experiment versions and dataset releases cannot change; the database enforces it.
  Any correction creates a new version, and the earlier one stays readable.
- **File integrity:** the ingest job reads each uploaded file in full and stores its SHA-256 (ADR 0016).
- **Provenance:** every transformation is recorded with the dataset release: the importer and its version,
  normalisation as reported by the source tool, imputation, dropped rows.
- **Reviewer tools:**
  - an audit viewer with per-entity history and CSV export;
  - a lineage view from raw files to results.
- **Validation:** `docs/validation/` maps requirements to the tests that verify them. It also holds IQ and OQ
  templates and a 21 CFR Part 11 controls map, so customers can validate their installation. Tributary itself is
  not a validated system.

## 5. Application security

- **Input validation:** every API boundary is validated against zod schemas, and the OpenAPI document is generated
  from the same schemas.
- **Queries:**
  - User queries are structured specifications compiled to parameterised SQL by the query service.
  - No component accepts SQL from the browser or from the AI assistant.
  - PostgreSQL is accessed through a typed query builder (Kysely) with bound parameters.
- **Large files:** they never pass through the API. Browsers upload straight to S3 with short-lived presigned
  multipart URLs.
- **Security headers:** CloudFront adds them to every response:
  - HSTS;
  - `X-Content-Type-Options: nosniff`;
  - `X-Frame-Options: DENY`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - a Content-Security-Policy (`modules/cloudfront/csp.json`).
- **Content-Security-Policy:**
  - **Allowed:** scripts, styles, images, fonts and connections from the app's own origin only. The single
    exception is browser uploads to the raw bucket.
  - **Refused:** inline scripts, `eval`, plug-ins and framing by other sites.
  - **Libraries:** WebGL charts use Plotly's precompiled (strict) renderer. The 3D viewer runs without string
    evaluation; its unused movie-export encoder is left out.
  - **Testing:** every end-to-end test runs under the production policy in CI, and one test fails on any reported
    violation.
- **Rate limiting:** the API limits requests per minute for each credential (default 600) and, for requests
  without one, for each client address (default 120). Over the limit it answers 429 with `Retry-After`. The limit
  applies before authentication, so guessing tokens is limited too.
- **Emails** carry no experiment values: they link back to the app, where access is checked.

## 6. AI features (optional)

- **Off by default:** AI features are off unless an administrator sets `AI_PROVIDER`.
  - With `bedrock`, requests go to Amazon Bedrock in the customer's AWS account and region.
  - With `anthropic`, prompts and tool results go to the Anthropic API under the customer's own agreement.
- **The assistant acts as the user** (ADR 0022):
  - its tools call the API with the user's own permissions and are audited as that user;
  - actions that change data need the user's explicit approval in the conversation.
- **Never:**
  - the assistant never writes or runs SQL;
  - the assistant never computes statistics (the compute service does).
- **Search embeddings** are optional and configured separately: none, Bedrock Titan, Voyage, or a local model.

## 7. Supply chain and development

- **Dependencies:**
  - Versions are pinned exactly, and installs use the lockfile only.
  - New dependencies are reviewed before they are added: publisher, age (at least 90 days unless approved) and
    licence.
- **Licences:** `pnpm run licence:scan` runs in CI and fails on GPL, AGPL, BUSL or non-commercial licences.
- **SBOM:** every CI run publishes an SPDX software bill of materials (`tributary-sbom.spdx.json`).
- **Checks before merging:** CI runs typecheck, lint, unit and integration tests (against a real PostgreSQL), the
  Python test suite, end-to-end tests including accessibility, and a Terraform plan.
- **Operations:**
  - logs and traces (OpenTelemetry) go to CloudWatch;
  - alarms cover 5xx rate, queue depth and failed runs;
  - RDS has daily snapshots and point-in-time recovery, with a restore runbook (`docs/RUNBOOK.md`);
  - a support bundle (Admin → Health) gives versions, migrations and recent failures, with no secrets or personal
    data, so support needs no access to the customer's environment.

## 8. Not built yet, and what to do meanwhile

| Gap | Meanwhile |
|---|---|
| Rate limiting is per API process, not global | The API limits each credential and each anonymous client address per minute (§5). With several replicas the effective limit is multiplied, so add AWS WAF rate-based rules for a global limit. |
| No row-level security in PostgreSQL | Each installation serves one organisation in its own account. Access is checked in the API per program. |
| No independent penetration test or SOC 2 report yet | Customers may run their own test against their installation. |
| Electronic signatures (21 CFR 11.50, 11.200) are partly covered | See `docs/validation/PART11_CONTROLS.md`: re-authentication and audit cover part; signature manifestation is procedural. |

Questions about this document: contact the Tributary team through your account contact.
