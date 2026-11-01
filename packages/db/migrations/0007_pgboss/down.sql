-- pg-boss 12.38.0 getUninstallPlans('pgboss'), then the schema.
DROP FUNCTION IF EXISTS pgboss.create_queue(text, jsonb), pgboss.delete_queue(text), pgboss.job_now(), pgboss.job_table_format(text, text), pgboss.job_table_run(text, text, text), pgboss.job_table_run_async(text, integer, text, text, text);
DROP TABLE IF EXISTS pgboss.bam, pgboss.instance, pgboss.job, pgboss.job_common, pgboss.job_dependency, pgboss.queue, pgboss.queue_stats, pgboss.schedule, pgboss.subscription, pgboss.version, pgboss.warning;
DROP TYPE IF EXISTS pgboss.job_state;
drop schema if exists pgboss cascade;
