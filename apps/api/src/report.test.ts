import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

// Phase 33: experiment reports are built in the browser (print to PDF, PowerPoint); every export is audited here.
describe('experiment report exports', () => {
  let t: TestApi;
  let reader: string;
  let outsider: string;
  let version: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    const program = await t.program('REP');
    const other = await t.program('REX');
    const scientist = (await t.user('rep-scientist', { [program]: 'contributor' })).token;
    reader = (await t.user('rep-viewer', { [program]: 'viewer' })).token;
    outsider = (await t.user('rep-outsider', { [other]: 'viewer' })).token;
    ({ version } = await publishedDaRelease(t, scientist, program, 'Reported DA'));
  }, 300_000);
  afterAll(() => t.close());

  const record = (token: string, payload: Record<string, unknown>) =>
    t.call(token, { method: 'POST', url: `/v1/versions/${version}/report-exports`, payload });

  it('REP-01: a reader records a PDF or PowerPoint export; it is audited; others cannot', async () => {
    const res = await record(reader, { format: 'pptx' });
    expect(res.statusCode, res.body).toBe(201);
    expect((await record(reader, { format: 'pdf' })).statusCode).toBe(201);
    expect((await record(reader, { format: 'docx' })).statusCode).toBe(400);
    expect([403, 404]).toContain((await record(outsider, { format: 'pdf' })).statusCode);
    const audit = await t.db
      .selectFrom('audit_log')
      .select(['action', 'entity_type', 'after'])
      .where('entity_id', '=', version)
      .where('action', '=', 'report.export')
      .orderBy('id')
      .execute();
    expect(audit.map((a) => (a.after as { format: string }).format)).toEqual(['pptx', 'pdf']);
    expect(audit[0]!.entity_type).toBe('experiment_version');
  });
});
