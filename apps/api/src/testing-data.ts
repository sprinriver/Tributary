import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const ONC_DIA_05 = resolve(import.meta.dirname, '../../../fixtures/experiments/ONC-DIA-05');
export const CONTRAST = {
  numerator: 'CPD-000005@1 µM',
  denominator: 'DMSO',
  label: 'CPD-000005@1 µM vs DMSO',
};

export function manifestRows(dir = ONC_DIA_05): Record<string, string>[] {
  const [header, ...lines] = readFileSync(`${dir}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
}

/** A published ONC-DIA-05 version with a published limma differential-abundance release. */
export async function publishedDaRelease(
  t: TestApi,
  token: string,
  programId: string,
  name: string,
): Promise<{ version: string; release: string }> {
  const call = (method: 'POST' | 'PUT', url: string, payload: Json) =>
    t.call(token, { method, url, payload, headers: { 'x-change-reason': 'test' } });
  const created = (
    await call('POST', '/v1/experiments', { program_id: programId, assay_type: 'proteomics_dia', name })
  ).json() as Json;
  const version = created.versions[0].id as string;
  await call('PUT', `/v1/versions/${version}/samples`, { rows: manifestRows() });
  const contrasts = (
    await call('PUT', `/v1/versions/${version}/contrasts`, { contrasts: [CONTRAST] })
  ).json() as Json;
  const bytes = readFileSync(`${ONC_DIA_05}/toptable.tsv`);
  const started = (
    await call('POST', '/v1/files/uploads', {
      experiment_version_id: version,
      name: 'toptable.tsv',
      size_bytes: bytes.length,
      role: 'processed',
    })
  ).json() as Json;
  const put = await fetch(started.parts[0].url, { method: 'PUT', body: bytes });
  await call('POST', `/v1/files/${started.file.id}/complete`, {
    parts: [{ part_number: 1, etag: put.headers.get('etag') }],
  });
  await t.drainIngest();
  const published = await call('POST', `/v1/versions/${version}/publish`, { reason: 'ready' });
  if (published.statusCode !== 200) throw new Error(published.body);
  const imported = await call('POST', '/v1/imports', {
    file_id: started.file.id,
    importer: 'limma_toptable',
    contrast_id: (contrasts.items ?? contrasts)[0].id,
  });
  if (imported.statusCode !== 201) throw new Error(imported.body);
  const release = (imported.json() as Json).id as string;
  await call('POST', `/v1/releases/${release}/publish`, { reason: 'checked' });
  return { version, release };
}

/** limma topTable rows of the fixture (ID, logFC, adj.P.Val), for expected values in tests. */
export function topTable(): { id: string; logFC: number; adjP: number }[] {
  const [header, ...lines] = readFileSync(`${ONC_DIA_05}/toptable.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => {
    const v = l.split('\t');
    return { id: v[0]!, logFC: Number(v[cols.indexOf('logFC')]), adjP: Number(v[cols.indexOf('adj.P.Val')]) };
  });
}
