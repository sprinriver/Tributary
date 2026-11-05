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
- [Onboarding legacy data](#onboarding-legacy-data)
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

## Gene sets for pathway enrichment
- **Import:** a system admin imports gene-set collections with `POST /api/v1/gene-set-collections` and a change
  reason.
- **What to send:**
  - `name`;
  - `source` and `source_release` (for example `Reactome` and `94`);
  - `species` (an NCBITaxon CURIE);
  - `id_type` (`gene_symbol` or `uniprot_accession`);
  - the GMT text, one set per line: `id<TAB>description<TAB>member…`.
- **Licences:**
  - Reactome publishes GMT files (CC0).
  - GO sets (CC BY 4.0) can be exported to GMT with common tools.
  - MSigDB's licence restricts use, so check yours before importing it.
- **Collections never change:** import a newer source release as a new collection. Every import is audited.
- **Demo:** the demo data includes "Demo modules (synthetic)", 20 invented modules.

## Usage
**Admin → Usage** counts what happened, from the audit log and the registry, for the last 4 to 52 weeks:
- active people;
- experiments created;
- versions and releases published;
- imports;
- pipeline runs;
- exports;
- assistant tool calls;
- triage actions.

It also shows each program's totals and last activity, and each person's last activity and actions in the last
30 days. "What each number counts" gives the exact definitions. **Download CSV** saves the weekly table; the
download is audited. Nothing is tracked for this page and nothing leaves your account.

## SCIM provisioning (Okta, Entra ID)
1. In **Admin → Access → SCIM provisioning**, note the SCIM endpoint (`…/api/scim/v2`) and press **Create SCIM
   token**. Copy the token: it is shown once. It acts as you, for SCIM only.
2. In your IdP's provisioning settings, set the tenant URL to the endpoint, set the secret token to the token, and
   test the connection.
3. Assign users and groups to the app.
   - **Roles:** groups get roles through the group mappings above, exactly like groups from sign-in.
   - **Deactivating** a user in the IdP removes their access at once (all sessions and tokens).
   - **Reactivating** restores it.
4. **First sign-in:** a provisioned user's first sign-in links to the provisioned account by email.

Revoke the token from the same panel if it leaks. Every SCIM change is in the audit log.

## Team notifications (Slack and Teams)
**Admin → Notifications** posts events to chat channels. The events are pipeline run finished, experiment version
published, dataset release published and triage decision.
1. **Get a webhook URL from the chat service.**
   - **Slack:** add an *Incoming Webhook* to the channel.
   - **Teams:** add a channel webhook, or a *Workflows* flow that posts to a channel when a webhook request is
     received.
2. **Add a channel.** Enter the name, service and URL, choose all programs or one, and pick the events.
   - The URL is a secret. It is never shown again, and audit records keep only its host.
   - URLs must use https and point at Slack's or Teams' own hosts. To allow another host (for example a proxy), set
     `NOTIFY_EXTRA_HOSTS`.
3. **Send a test** to check the channel. Each channel lists its last deliveries.
   - **Retries:** a failed delivery is retried four times over about 8 minutes, then marked failed.
   - **Pause:** pausing a channel stops new messages without losing its settings.

Messages carry names, statuses, the person who acted, a triage reason, and a link back to Tributary. They never
include data values, but they do leave your AWS account, so choose channels your organisation approves.

## Personal email
People can receive email about their own items:
- a new hit for something they watch;
- a triage item assigned to them;
- their pipeline run finishing.

Each person chooses under their name → **Email notifications**. To turn email on, set:
- `EMAIL_TRANSPORT=ses`: Amazon SES in `SES_REGION` (default `AWS_REGION`). Give the API's role
  `ses:SendEmail` and verify the sender domain in SES.
- `EMAIL_TRANSPORT=smtp` with `SMTP_URL` (for example `smtps://user:pass@smtp.example.org:465`).
- `EMAIL_FROM`: the sender, for example `Tributary <no-reply@your-domain>`.

Without `EMAIL_TRANSPORT` nothing is queued. Emails contain names and links, never data values. They are retried
like channel messages.

## Onboarding legacy data
Historical data on a shared drive or another bucket can be registered in bulk (API only for now).

1. **Copy the files:** put the data under a linkable prefix (`S3_LINKABLE_PREFIXES`, default `incoming/`), keeping
   its folder layout.
2. **Describe the layout:** use path patterns relative to the prefix. Tokens are `{experiment}` (required),
   `{sample}`, any other name (it becomes a manifest column), and `{*}` (ignored). For example:
   - `{experiment}/raw/{sample}.raw` with role `raw`
   - `{experiment}/processed/report.pg_matrix.tsv` with role `processed` and importer `diann_pg_matrix`
3. **Dry run:** `POST /v1/onboarding/plan` shows the experiments, the inferred sample manifests and each file's
   role. Objects no pattern matches are listed and never registered. Nothing is written.
4. **Run:** `POST /v1/onboarding/runs` (with `X-Change-Reason`). It creates or reuses each experiment, adds the
   samples it does not have yet, links the files (checksums run in the background) and imports matching files
   once they pass QC.
   - Each call handles `max_experiments` experiments.
   - `POST /v1/onboarding/runs/<id>/resume` continues, and retries anything that failed.
5. **Report:** `GET /v1/onboarding/runs/<id>` is the migration report: counts, failures with their reasons,
   unmatched objects, and every file's checksum, size and QC status.

Everything a run does goes through the normal endpoints as the person running it, with the same permissions,
validation and audit rows. Inferred manifests are drafts: review them, fix the cells flagged with errors, then
publish.

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
