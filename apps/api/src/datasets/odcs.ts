import type { ColumnType, DatasetContract } from '@tributary/contracts';
import { contractAssertions } from '@tributary/importers';

// Open Data Contract Standard v3.0.2 (bitol-io/open-data-contract-standard) YAML for a dataset kind.

const LOGICAL: Record<ColumnType, string> = {
  text: 'string',
  uuid: 'string',
  double: 'number',
  integer: 'integer',
  boolean: 'boolean',
  date: 'date',
  timestamp: 'date',
  'text[]': 'array',
  'double[]': 'array',
  json: 'object',
};
const PHYSICAL: Record<ColumnType, string> = {
  text: 'VARCHAR',
  uuid: 'UUID',
  double: 'DOUBLE',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMPTZ',
  'text[]': 'VARCHAR[]',
  'double[]': 'DOUBLE[]',
  json: 'JSON',
};

/** A YAML scalar: plain when unambiguous, else double-quoted (JSON strings are valid YAML). */
function scalar(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  const plain =
    /^[A-Za-z_][A-Za-z0-9_.\-/]*$/.test(value) && !/^(true|false|null|yes|no|on|off|~)$/i.test(value);
  return plain ? value : JSON.stringify(value);
}

export function odcsYaml(contract: DatasetContract): string {
  const lines: string[] = [];
  const add = (indent: number, text: string) => lines.push(`${' '.repeat(indent)}${text}`);
  add(0, 'apiVersion: v3.0.2');
  add(0, 'kind: DataContract');
  add(0, `id: ${scalar(`urn:tributary:contract:${contract.kind}:${contract.version}`)}`);
  add(0, `name: ${contract.kind}`);
  add(0, `version: ${contract.version}`);
  add(0, 'status: active');
  add(0, 'description:');
  add(2, `purpose: ${scalar(contract.description)}`);
  add(
    2,
    `usage: ${scalar(`Tributary ${contract.category} dataset; join keys: ${contract.joinKeys.join(', ') || 'none'}`)}`,
  );
  add(0, 'schema:');
  add(2, `- name: ${contract.kind}`);
  add(4, `physicalName: ${contract.kind}`);
  add(4, 'logicalType: object');
  add(4, 'physicalType: table');
  add(4, 'properties:');
  for (const c of contract.columns) {
    add(6, `- name: ${c.name}`);
    add(8, `logicalType: ${LOGICAL[c.type]}`);
    add(8, `physicalType: ${scalar(PHYSICAL[c.type])}`);
    add(8, `required: ${!c.nullable}`);
    const description = [c.description, c.unit ? `unit: ${c.unit}` : undefined].filter(Boolean).join('; ');
    if (description) add(8, `description: ${scalar(description)}`);
  }
  add(4, 'quality:');
  for (const a of contractAssertions(contract, contract.kind)) {
    add(6, `- name: ${a.id}`);
    add(8, 'type: sql');
    add(8, `description: ${scalar(a.source)}`);
    add(8, `query: ${scalar(a.countSql ?? `SELECT count(*) FROM (${a.sql})`)}`);
    add(8, 'mustBe: 0');
    add(8, `severity: ${a.severity}`);
  }
  return `${lines.join('\n')}\n`;
}
