-- Extensions, id generation and shared types.
create extension if not exists vector;

-- UUIDv7 (RFC 9562 §5.7): 48-bit Unix epoch milliseconds, version 7, RFC variant, random remainder.
-- Starts from a v4 UUID (random bits, variant already 10) and overwrites the timestamp and version.
-- Postgres 18 ships uuidv7(); this keeps Postgres 17 (RDS, local) on the same ids.
create function uuidv7() returns uuid
language plpgsql volatile parallel safe as $$
declare
  ts_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  bytes bytea := uuid_send(gen_random_uuid());
begin
  bytes := overlay(bytes placing substring(int8send(ts_ms) from 3) from 1 for 6);
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
  return encode(bytes, 'hex')::uuid;
end
$$;

create type assay_type_key as enum ('proteomics_dia', 'proteomics_dda', 'proteomics_tmt', 'rnaseq', 'crispr_screen', 'ngs_raw');

-- Keeps updated_at current on every UPDATE (attached per table in 0005).
create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;
