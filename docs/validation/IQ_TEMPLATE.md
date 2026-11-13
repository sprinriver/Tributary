# Installation qualification (IQ) protocol — template

| Field | Value |
|---|---|
| System | Tributary |
| Release under test | _e.g. 2.1.0_ |
| Environment | _e.g. Production, AWS account …, region …_ |
| Protocol ID / version | |
| Prepared by / date | |
| Approved by (QA) / date | |

**Objective:** verify that the installed system matches the released software and the approved configuration.

**Evidence to attach:**
- the support bundle (Admin → Health → Download support bundle);
- `terraform plan` output for the environment;
- screenshots where noted.

| # | Check | Expected result | How to check | Result (pass/fail) | Evidence ref | Initials / date |
|---|---|---|---|---|---|---|
| IQ-1 | Software version | Support bundle `instance.version` (and `build`) equal the approved release | Support bundle | | | |
| IQ-2 | Database migrations | `database.migrations_pending` is empty; `migrations_applied` lists every migration of the release | Support bundle | | | |
| IQ-3 | Services healthy | Health report overall "ok"; database, object storage, query and compute services "ok" | Admin → Health | | | |
| IQ-4 | Infrastructure as approved | `terraform plan` shows no changes against the approved configuration | Deployment pipeline | | | |
| IQ-5 | Encryption at rest | S3 buckets and RDS use the customer-managed KMS key | AWS console or `terraform plan` | | | |
| IQ-6 | Single sign-on | `configuration.oidc_issuer_host` is the approved identity provider; sign-in works for a test user | Support bundle; sign-in | | | |
| IQ-7 | Role mapping | IdP group → role mappings match the approved access matrix | Admin → Access | | | |
| IQ-8 | Provisioning (if used) | SCIM token exists, owned by an approved admin; IdP connection test passes | Admin → Access; IdP | | | |
| IQ-9 | Email and chat (if used) | `configuration.email_transport` and channel routes as approved; a test message is delivered | Support bundle; Admin → Notifications | | | |
| IQ-10 | Retention | Storage lifecycle policies match the records retention schedule | Admin → Lifecycle | | | |
| IQ-11 | Backups | RDS automated backups and snapshot retention as approved; restore rehearsed per `docs/RUNBOOK.md` | AWS console; runbook record | | | |
| IQ-12 | Time | Server time is UTC and synchronised (audit timestamps are UTC) | Support bundle `generated_at` vs reference clock | | | |

**Deviations:**

**Conclusion and approval:**
