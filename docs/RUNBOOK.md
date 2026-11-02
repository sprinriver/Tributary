# Operations runbook

This runbook is for operators of a Tributary deployment: the AWS deployment ([`DEPLOY.md`](DEPLOY.md)) and, where
noted, the single-server or local stack. Targets (SPEC §9): **RPO 24 h, RTO 4 h**; single-AZ by default, with a
Multi-AZ RDS option.

## What holds state
| Store | AWS | What is in it | Protection |
|---|---|---|---|
| Postgres | RDS (`<name>`) | Registry, manifests, releases metadata, audit log, users, sessions, job queue (pg-boss) | Automated backups (14 days, point-in-time), final snapshot on delete, deletion protection |
| Raw files | S3 `<name>-raw` | Uploaded instrument and processed files | Versioning; noncurrent versions kept for 90 days |
| Dataset releases | S3 `<name>-warehouse` (+ S3 Tables) | Parquet for every release (immutable) | Versioning; releases are never rewritten |
| Pipeline work | S3 `<name>-work` | Nextflow work and output directories | Versioning (reproducible from inputs) |
| Exports | S3 `<name>-exports` | Query exports | Expire after 30 days by design |
| Secrets | Secrets Manager | Cookie secret, internal token, OIDC client secret, RDS master | KMS; recreate or rotate |
| Keys | KMS `alias/<name>` | Encryption of all of the above | 30-day deletion window; never schedule deletion while data exists |

## Backups
- **Database:**
  - RDS takes daily automated snapshots and transaction logs, so point-in-time restore is possible within the
    retention window.
  - Before a risky change (a major version or a large migration), take a manual snapshot:
    `aws rds create-db-snapshot --db-instance-identifier <name> --db-snapshot-identifier <name>-pre-<change>`.
- **Objects:** S3 versioning keeps every overwritten or deleted object version (90 days for noncurrent
  versions). For a second copy in another region or account, add S3 replication: it is off by default,
  `infra/terraform/.checkov.yaml` says why, and it is a policy decision.
- **Off-site exports:** for an extra logical copy, schedule
  `pg_dump -Fc` from a bastion or one-off task to a separate, locked bucket.

## Restore
### Database, point in time (AWS)
1. Pick the time to return to (before the incident).
2. Restore into a **new** instance; the original stays untouched until you switch:
   ```sh
   aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier <name> \
     --target-db-instance-identifier <name>-restore --restore-time 2026-11-01T10:00:00Z \
     --db-subnet-group-name <name> --vpc-security-group-ids <db-sg> --db-parameter-group-name <name>-pg17
   ```
3. Check the restored database:
   - Connect from a one-off task or bastion.
   - `select count(*) from experiment`, from `dataset_release`, and the latest `audit_log.at`.
4. Switch the application:
   - **Option A:** set `DATABASE_HOST` to the new endpoint (a `terraform plan`/`apply` with an override, or a new
     task definition), then force new deployments of `api` and `query`.
   - **Option B:** rename the instances (old → `<name>-old`, restored → `<name>`) during a short maintenance window.
5. Keep the old instance until the restore is confirmed, then delete it (a final snapshot is taken).

### Objects (AWS)
- **One object:** list its versions (`aws s3api list-object-versions --bucket <b> --prefix <key>`) and copy the wanted
  version over the current one (`aws s3api copy-object --copy-source "<b>/<key>?versionId=<v>" …`).
- **Deleted objects:** remove the delete marker (`aws s3api delete-object --bucket <b> --key <k> --version-id <marker>`).
- **Releases** are immutable and referenced by key and sha256 in Postgres, so a database restore and the versioned
  warehouse bucket stay consistent.

### Rehearsal (local stack; done for v2.0)
`pnpm run ops:rehearse-restore` runs `scripts/ops/rehearse-restore.sh`. It:
1. Dumps the database (`pg_dump -Fc`).
2. Restores it into a scratch database.
3. Compares the row count of every table.
4. Archives the object store.

Result on 2026-11-02:
```
== backup: pg_dump (custom format)
   size 1882914 bytes
== compare row counts (source vs restored)
   58 tables compared, 0 mismatches
== object store: archive the SeaweedFS volume
   188 entries in seaweedfs.tar.gz
rehearsal: OK
```
A rehearsal on AWS (point-in-time restore into a new instance, then switching) is still to be done by the
customer's platform team in a sandbox account. Record the time it takes against the 4 h RTO.

## Alarms
Create these as CloudWatch alarms that notify the on-call channel (SNS). They are not in the Terraform yet, so add
them in the customer's monitoring stack. Thresholds are starting points.

| Alarm | Metric | Threshold | First response |
|---|---|---|---|
| API 5xx rate | ALB `HTTPCode_Target_5XX_Count` / `RequestCount` | > 2 % for 5 min | API logs (`/ecs/<name>-api`), recent deploy? Roll back the image |
| API unhealthy | ALB `UnHealthyHostCount` | ≥ 1 for 5 min | Task events in ECS; database reachable? |
| API latency | ALB `TargetResponseTime` p95 | > 5 s for 10 min | Query service CPU/memory; slow queries in RDS Performance Insights |
| Query service memory | ECS `MemoryUtilization` (`<name>-query`) | > 85 % for 10 min | DuckDB OOM risk: lower `QUERY_MEMORY_LIMIT`, raise task memory |
| Query service restarts | ECS task stopped reason contains `OutOfMemory` | any | As above |
| Run events backlog | SQS `ApproximateAgeOfOldestMessage` (`<name>-run-events`) | > 15 min | API consumer running? Check the IAM role and the queue URL |
| Run events dead-letter | SQS `ApproximateNumberOfMessagesVisible` (`…-dlq`) | ≥ 1 | Inspect the message; the poller still updates run status |
| Failed pipeline runs | App: runs with status `failed` (Admin → Health → job queue; `pipeline_run`) | > 3 in 1 h | Run page logs; Batch job status reason |
| Ingest queue failures | pg-boss jobs `failed` (Admin → Health) | > 0 | API logs for `ingest failed` |
| Database CPU | RDS `CPUUtilization` | > 80 % for 15 min | Performance Insights top SQL |
| Database storage | RDS `FreeStorageSpace` | < 10 GB | Autoscaling raises it to `max_allocated_storage_gb`; raise the ceiling |
| Database connections | RDS `DatabaseConnections` | > 80 % of max | Too many tasks? Check for leaked connections |
| CloudFront 5xx | CloudFront `5xxErrorRate` | > 1 % for 5 min | Origin (ALB) health |

**Logs:**
- **API and query** log JSON lines (pino) with `reqId`; every request's log carries the same id from the ALB
  through `api` to `query`/`compute`. Search CloudWatch Logs Insights:
  `fields @timestamp, msg, reqId | filter reqId = "<id>"`.
- **Audit:** the audit log (Admin → Audit) records every mutation and export, with the actor and reason.

## Routine operations
- **Deploy a new version:** [`DEPLOY.md`](DEPLOY.md) → Updating.
- **Roll back:** [`DEPLOY.md`](DEPLOY.md) → Rollback.
- **Rotate the cookie secret:** put a new value into `<name>/cookie-secret`, then force new deployments of `api`.
  This signs everyone out.
- **Rotate the internal query token:** update `<name>/query-internal-token`, then force new deployments of `api` and
  `query` together.
- **Rotate the OIDC client secret:** rotate it in the IdP, update `<name>/oidc-client-secret`, then redeploy `api`.
- **Reindex search:** Admin → Health → Reindex (or `POST /v1/admin/search/reindex`), after bulk loads.
- **Grant access:** map IdP groups to roles (Admin → Access); changes apply on the next request.

## Incident checklist
1. Note the time window, the affected users and a `reqId` from the error.
2. Check **Admin → Health**: database, storage, query, compute, IdP and job queue.
3. Read the logs by `reqId`, then look for the first error.
4. **If data was changed wrongly:** the audit log shows who, what, before/after and why. Published versions and
   releases are immutable, so the fix is a new version, not an edit.
5. **If data was lost:** restore (above) into a new instance, compare, then switch.
6. Write up what happened, the timeline, the cause and the follow-ups.
