import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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
  /**
   * Another file (default: the fixture's topTable), the experiment's species (default: none recorded), another
   * fixture file and importer (e.g. the DIA-NN matrix), and the experiment date.
   */
  options: {
    bytes?: Buffer;
    species?: { id: string; label: string };
    file?: string;
    importer?: string;
    /** Importer options (e.g. compound and doses for CurveCurator). */
    importOptions?: Record<string, unknown>;
    experimentDate?: string;
    /** More files of the same version, each imported into its own dataset (e.g. one per compound). */
    extra?: {
      file: string;
      importer: string;
      datasetName: string;
      importOptions?: Record<string, unknown>;
    }[];
  } = {},
): Promise<{ version: string; release: string; extra: string[] }> {
  const call = (method: 'POST' | 'PUT', url: string, payload: Json) =>
    t.call(token, { method, url, payload, headers: { 'x-change-reason': 'test' } });
  const created = (
    await call('POST', '/v1/experiments', {
      program_id: programId,
      assay_type: 'proteomics_dia',
      name,
      ...(options.species ? { species: options.species } : {}),
      ...(options.experimentDate ? { experiment_date: options.experimentDate } : {}),
    })
  ).json() as Json;
  const version = created.versions[0].id as string;
  await call('PUT', `/v1/versions/${version}/samples`, { rows: manifestRows() });
  const contrasts = (
    await call('PUT', `/v1/versions/${version}/contrasts`, { contrasts: [CONTRAST] })
  ).json() as Json;
  const upload = async (file: string, bytes: Buffer, name = basename(file)) => {
    const started = (
      await call('POST', '/v1/files/uploads', {
        experiment_version_id: version,
        name,
        size_bytes: bytes.length,
        role: 'processed',
      })
    ).json() as Json;
    const put = await fetch(started.parts[0].url, { method: 'PUT', body: bytes });
    await call('POST', `/v1/files/${started.file.id}/complete`, {
      parts: [{ part_number: 1, etag: put.headers.get('etag') }],
    });
    return started.file.id as string;
  };
  const file = options.file ?? 'toptable.tsv';
  const fileId = await upload(file, options.bytes ?? readFileSync(resolve(ONC_DIA_05, file)));
  const extraFiles: string[] = [];
  for (const [i, x] of (options.extra ?? []).entries())
    extraFiles.push(
      await upload(x.file, readFileSync(resolve(ONC_DIA_05, x.file)), `extra-${i}-${basename(x.file)}`),
    );
  await t.drainIngest();
  const published = await call('POST', `/v1/versions/${version}/publish`, { reason: 'ready' });
  if (published.statusCode !== 200) throw new Error(published.body);
  const imported = await call('POST', '/v1/imports', {
    file_id: fileId,
    importer: options.importer ?? 'limma_toptable',
    ...(options.importOptions ? { options: options.importOptions } : {}),
    ...(options.importer && options.importer !== 'limma_toptable'
      ? {}
      : { contrast_id: (contrasts.items ?? contrasts)[0].id }),
  });
  if (imported.statusCode !== 201) throw new Error(imported.body);
  const release = (imported.json() as Json).id as string;
  await call('POST', `/v1/releases/${release}/publish`, { reason: 'checked' });
  const extra: string[] = [];
  for (const [i, x] of (options.extra ?? []).entries()) {
    const more = await call('POST', '/v1/imports', {
      file_id: extraFiles[i],
      importer: x.importer,
      dataset_name: x.datasetName,
      ...(x.importOptions ? { options: x.importOptions } : {}),
    });
    if (more.statusCode !== 201) throw new Error(more.body);
    extra.push((more.json() as Json).id as string);
    await call('POST', `/v1/releases/${extra.at(-1)}/publish`, { reason: 'checked' });
  }
  return { version, release, extra };
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

/** A published ONC-DIA-05 version with a published DIA-NN protein_quant release (one row per protein × run). */
export const publishedPqRelease = (
  t: TestApi,
  token: string,
  programId: string,
  name: string,
  options: { bytes?: Buffer; experimentDate?: string } = {},
) =>
  publishedDaRelease(t, token, programId, name, {
    ...options,
    file: 'report.pg_matrix.tsv',
    importer: 'diann_pg_matrix',
  });
