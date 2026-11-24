# Security questionnaire: prepared answers

Answers to the questions that recur in customer security reviews (the themes of CAIQ-Lite and SIG-Lite). They
describe the **product**. Questions about your company (policies, staff screening, insurance, incident response)
need your own answers: they are listed at the end. Details and code references are in
`docs/SECURITY_WHITEPAPER.md`.

## Hosting and data
| Question | Answer |
|---|---|
| Where is customer data stored? | In the customer's own AWS account and region. The vendor runs no shared service and holds no copy. |
| Is data encrypted at rest? | Yes: RDS, S3 and S3 Tables use customer-managed KMS keys with rotation. |
| Is data encrypted in transit? | Yes: TLS 1.2 or 1.3 only at the load balancer; HSTS at CloudFront. |
| Does the product send data to third parties? | Only for features the customer turns on: identity provider, email, Slack or Teams webhooks, an AI provider, AlphaFold DB. AI is off by default; with Amazon Bedrock, requests stay in the customer's account. |
| Can vendor staff access customer data? | Not by default. Support works from a diagnostics bundle with no secrets or personal data. Any access is granted by the customer. |
| How is data deleted? | Records are soft-deleted in the application; the customer controls the database, buckets and their retention and can delete the whole environment. |
| Backups and recovery? | Daily RDS snapshots and point-in-time recovery, versioned S3 buckets, and a restore runbook. RPO and RTO depend on the customer's settings and should be measured in their drill. |

## Access control
| Question | Answer |
|---|---|
| Authentication? | Single sign-on with OpenID Connect (authorization code with PKCE). No passwords are stored. |
| Multi-factor authentication? | Enforced by the customer's identity provider. |
| Provisioning and deprovisioning? | SCIM 2.0. Deactivating a user ends their sessions and tokens on the next request. |
| Authorisation model? | Roles per program (viewer, contributor, approver) and system admins, enforced on the server for every request. |
| API access? | Personal access tokens: scoped, expiring, stored as hashes. |
| Session management? | Server-side sessions, httpOnly and Secure cookies, SameSite=strict, 12-hour default lifetime, CSRF tokens. |
| Privileged actions? | Publishing and approving need a recent sign-in, recorded in the audit trail. |

## Application security
| Question | Answer |
|---|---|
| Input validation? | Every API boundary is validated against schemas; the OpenAPI document is generated from them. |
| SQL injection? | Queries are parameterised. No component accepts SQL from the browser or the AI assistant. |
| Browser protections? | A Content-Security-Policy without `eval` or inline scripts, HSTS, no framing, `nosniff`. |
| Rate limiting? | Per credential and per anonymous client address, per API process. A WAF rule is recommended for a global limit. |
| Audit logging? | Every change and export is logged with actor, time, before and after values and reason. The log is append-only, enforced by database triggers and grants. |
| Data integrity? | Published versions and releases are immutable; uploaded files are checksummed. |

## Development and supply chain
| Question | Answer |
|---|---|
| Secure development practices? | Tests are written first; CI runs type checks, lint, unit, integration, end-to-end and accessibility tests, and a Terraform validation, on every change. |
| Dependency management? | Exact-pinned versions, lockfile-only installs, review of each new dependency, a licence scan in CI. |
| SBOM? | An SPDX SBOM is produced by every CI run. |
| Vulnerability disclosure? | `SECURITY.md` describes private reporting. |
| Penetration testing? | No independent test yet. Customers may test their own installation. |
| Certifications (SOC 2, ISO 27001)? | None yet. The product runs in the customer's account under the customer's controls. |

## Questions you must answer for your company
- Information security policy, risk assessments and their review dates.
- Staff background checks, security training and offboarding.
- Incident response plan, breach notification times and contacts.
- Business continuity for the support service.
- Sub-processors, if you ever access customer environments.
- Insurance cover.
