import { describe, expect, it } from 'vitest';
import {
  AuditEventSchema,
  ExperimentVersionSchema,
  experimentUrn,
  experimentVersionUrn,
  UuidV7Schema,
} from './index.ts';

const id = (n: number) => `019a2b3c-4d5e-7f00-8a00-${String(n).padStart(12, '0')}`;
const base = (n: number) => ({
  id: id(n),
  tenant_id: id(900),
  created_at: '2026-10-26T12:00:00Z',
  created_by: id(901),
  updated_at: '2026-10-26T12:00:00Z',
  deleted_at: null,
});

describe('entity schemas', () => {
  it('CON-03: ids must be UUIDv7', () => {
    expect(UuidV7Schema.safeParse(id(1)).success).toBe(true);
    expect(UuidV7Schema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success).toBe(false);
  });

  it('CON-03: experiment and version URNs follow the SPEC format', () => {
    expect(experimentUrn(id(1))).toBe(`urn:tributary:experiment:${id(1)}`);
    expect(experimentVersionUrn(id(1), 3)).toBe(`urn:tributary:experiment:${id(1)}:v3`);
  });

  it('CON-03: a published experiment version needs a publish reason', () => {
    const version = {
      ...base(2),
      experiment_id: id(1),
      version_number: 1,
      parent_version_id: null,
      status: 'published',
      template_version: '1.0.0',
      experiment_date: '2026-10-01',
      species: { id: 'NCBITaxon:9606', label: 'Homo sapiens' },
      spectral_library: null,
      time_points: [],
      description: '',
      custom: {},
      publish_reason: null,
      published_by: id(901),
      published_at: '2026-10-26T12:00:00Z',
      urn: experimentVersionUrn(id(1), 1),
    };
    const result = ExperimentVersionSchema.safeParse(version);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['publish_reason']);
    expect(ExperimentVersionSchema.safeParse({ ...version, publish_reason: 'first release' }).success).toBe(
      true,
    );
  });

  it('CON-03: audit events record an actor type from the allowed set', () => {
    const event = {
      id: id(3),
      actor_id: id(901),
      actor_type: 'ai_assistant_on_behalf_of',
      action: 'experiment_version.publish',
      entity_type: 'experiment_version',
      entity_id: id(2),
      before: null,
      after: { status: 'published' },
      reason: 'first release',
      request_id: 'req-1',
      ip: '10.0.0.1',
      at: '2026-10-26T12:00:00Z',
    };
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
    expect(AuditEventSchema.safeParse({ ...event, actor_type: 'robot' }).success).toBe(false);
  });
});
