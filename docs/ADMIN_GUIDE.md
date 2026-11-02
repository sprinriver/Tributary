# Tributary admin guide

For system administrators. Installing and operating the platform are covered elsewhere:
- **AWS:** [`DEPLOY.md`](DEPLOY.md)
- **Operations (backups, restore, alarms):** [`RUNBOOK.md`](RUNBOOK.md)
- **Demos:** [`DEPLOY_HUGGINGFACE.md`](DEPLOY_HUGGINGFACE.md) and [`DEPLOY_RENDER.md`](DEPLOY_RENDER.md)
- **Settings and environment variables:** the README → Configuration

Everything below is in the app under **Admin**, visible to the `system_admin` role. Every change writes an audit
row.

- [Access: who can do what](#access-who-can-do-what)
- [Programs](#programs)
- [Templates](#templates)
- [Picklists and ontologies](#picklists-and-ontologies)
- [Pipelines](#pipelines)
- [Storage lifecycle](#storage-lifecycle)
- [Health](#health)
- [Audit log](#audit-log)
- [Search index](#search-index)
- [The assistant](#the-assistant)
- [Checklist for a new installation](#checklist-for-a-new-installation)

## Access: who can do what
- **Sign-in:** people sign in through your identity provider (OIDC). Tributary has no local passwords in
  production.
- **Roles come from groups:** each IdP group maps to a role in a program, or to `system_admin`. Set this in
  **Admin → Access**, or with `AUTH_GROUP_ROLE_MAP`.
- **Roles, from least to most:**
  - viewer
  - contributor
  - approver
  - admin (one program)
  - system_admin (everything)
- **When changes apply:** on each user's next request.
- **Re-authentication:** publishing and approving ask for a recent sign-in (re-authentication at the IdP).

## Programs
**Admin → Programs** adds programs (for example ONC, IMM). Each program has its own members and its own
experiments, datasets and saved views. Users see only the data of the programs their roles cover.

## Templates
- **What they do:** experiment templates decide the custom fields and sample columns for each program and assay
  type.
- **Editing:** **Admin → Templates** edits a draft with a live form preview, then publishes it as a new template
  version.
- **Effect:** published experiment versions keep the template version they used. New drafts follow the latest one.

![Template preview](../artifacts/phase-18/template-preview.png)

## Picklists and ontologies
- **Picklists:** **Admin → Lists** edits picklists such as time points, cell lines and instruments.
- **Ontology sources:** the same page switches ontology sources (OLS4) on or off. Without network access, the
  built-in terms are used.

![Lists](../artifacts/phase-18/admin-lists.png)

## Pipelines
- **Adding a pipeline:** **Admin → Pipelines** adds one from its nf-schema JSON, which also generates the launch form
  (with a preview).
- **Revisions:** each pipeline lists the revisions users may launch.
- **Where pipelines run:** on AWS Batch or AWS HealthOmics (configured by the deployment). `pipelines/demo` runs
  locally for testing.
- **The QC gate:** launches are blocked while an input file has failed QC, until an approver overrides it with a
  reason.

![Pipelines](../artifacts/phase-11/admin-pipeline.png)

## Storage lifecycle
- **Policies by file role:** **Admin → Lifecycle** sets storage-class transitions and expiry by file role (raw,
  processed, work, export).
- **What never expires:** published releases are never removed, and exports expire after 30 days by default.

## Health
**Admin → Health** checks each dependency:
- database
- object storage
- query service
- compute service
- identity provider
- job queue
- search index
- pipeline runners

Check it first when something looks wrong (see [`RUNBOOK.md`](RUNBOOK.md) → Incident checklist).

![Health](../artifacts/phase-18/admin-health.png)

## Audit log
- **What it records:** **Admin → Audit** lists every mutation, export, admin change and assistant tool call. Each
  row has the actor, action, entity, before and after, reason, and request id.
- **Filtering and export:** filter by actor, action, entity or date, and export the result as CSV.
- **Tracing a request:** the request id matches the `reqId` in the API, query and compute logs, so one id traces a
  request end to end.

![Audit](../artifacts/phase-18/audit-log.png)

## Search index
Search updates as things change. After a bulk load or a restore, rebuild it with **Admin → Health → Reindex**
(`POST /v1/admin/search/reindex`).

## The assistant
- **Off by default:** the assistant is off unless `AI_PROVIDER` is set (`anthropic` or `bedrock`).
- **Budget:** `AI_MONTHLY_TOKEN_BUDGET` caps its use.
- **Same permissions, approved writes:** it uses the user's own permissions, and any write it proposes waits for
  that user's approval.
- **Audited:** every tool call is in the audit log.

## Checklist for a new installation
1. **Identity provider:** configure the OIDC client and group claim, and map groups to roles (**Access**).
2. **Programs:** create the programs and add the first members through their groups.
3. **Templates:** review the templates per program and assay, then publish.
4. **Lists:** load the picklists (cell lines, instruments, time points).
5. **Pipelines:** register them and check that **Health** shows the runner as configured.
6. **Lifecycle:** set the storage lifecycle policies.
7. **Verify:** run a test experiment end to end: register → samples → publish → upload → run or import → explore
   → chart.
8. **Backups:** confirm they and the alarms are in place ([`RUNBOOK.md`](RUNBOOK.md)).
