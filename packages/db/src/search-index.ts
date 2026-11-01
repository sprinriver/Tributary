import { SEED_TERMS } from '@tributary/contracts';
import { createHash } from 'node:crypto';
import type { Database } from './client.ts';

// Search documents (SPEC M9, ADR 0020): rebuilt per experiment from its latest published (or archived) version.
// Only fields flagged `searchable` (template and version custom fields) plus the experiment's own descriptive
// fields are indexed. Drafts and archived experiments are not searchable.

type Json = unknown;
interface FieldDef {
  key: string;
  scope: string;
}
interface Term {
  id: string;
  label: string;
}

const SAMPLE_COLUMNS = ['sample_key', 'source_name'] as const;
const SAMPLE_BAGS = ['characteristics', 'factors', 'technical', 'custom'] as const;

const isTerm = (v: Json): v is Term =>
  typeof v === 'object' && v !== null && 'id' in v && 'label' in v && typeof v.label === 'string';

/** Display text of a stored value: ontology terms by label, quantities by display text, scalars as text. */
function valueText(v: Json): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (isTerm(v)) return v.label;
  if (typeof v === 'object' && 'display' in v && typeof v.display === 'string') return v.display;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** Hyphenated words also indexed without hyphens, so "K562" finds "K-562" and "MCF7" finds "MCF-7". */
export function dehyphenated(text: string): string[] {
  const words = text.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+/gu) ?? [];
  return [...new Set(words.map((w) => w.replaceAll('-', '').toLowerCase()))];
}

const SEED_SYNONYMS = new Map(SEED_TERMS.map((t) => [t.id, [...(t.synonyms ?? [])]]));

/** Synonyms of the given terms: the seed list merged with the OLS4 cache (filled as terms are looked up). */
async function synonymsOf(db: Database, termIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of termIds) out.set(id, [...(SEED_SYNONYMS.get(id) ?? [])]);
  if (termIds.length) {
    const cached = await db
      .selectFrom('ontology_term_cache')
      .select(['term_id', 'synonyms'])
      .where('term_id', 'in', termIds)
      .execute();
    for (const row of cached)
      out.set(row.term_id, [...new Set([...(out.get(row.term_id) ?? []), ...row.synonyms])]);
  }
  return out;
}

const uniq = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v?.trim()))];
const hash = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

/** Rebuilds the documents of one experiment; returns how many were written. Run inside the caller's transaction. */
export async function reindexExperiment(db: Database, experimentId: string, actor: string): Promise<number> {
  const rows = await documentsOf(db, experimentId, actor);
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insertInto('search_document')
      .values(rows.slice(i, i + 500))
      .onConflict((oc) =>
        oc.columns(['entity_type', 'entity_id']).doUpdateSet((eb) => ({
          ...Object.fromEntries(UPDATED.map((c) => [c, eb.ref(`excluded.${c}`)])),
          deleted_at: null,
        })),
      )
      .execute();
  }
  // Documents of earlier versions, removed samples, drafts or archived experiments stop being searchable.
  const kept = rows.map((r) => r.entity_id);
  await db
    .updateTable('search_document')
    .set({ deleted_at: new Date() })
    .where('experiment_id', '=', experimentId)
    .where('deleted_at', 'is', null)
    .$if(kept.length > 0, (q) => q.where('entity_id', 'not in', kept))
    .execute();
  return rows.length;
}

const UPDATED = [
  'experiment_version_id',
  'program_id',
  'assay_type',
  'status',
  'species',
  'compounds',
  'title',
  'subtitle',
  'body',
  'expansions',
  'content_hash',
] as const;

async function documentsOf(db: Database, experimentId: string, actor: string) {
  const experiment = await db
    .selectFrom('experiment as e')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .leftJoin('assay_type as a', (j) => j.onRef('a.key', '=', 'e.assay_type').on('a.deleted_at', 'is', null))
    .select([
      'e.id',
      'e.tenant_id',
      'e.name',
      'e.program_id',
      'e.assay_type',
      'e.archived_at',
      'e.deleted_at',
      'p.code as program_code',
      'p.name as program_name',
      'a.label as assay_label',
    ])
    .where('e.id', '=', experimentId)
    .executeTakeFirst();
  if (!experiment || experiment.deleted_at || experiment.archived_at) return [];
  const version = await db
    .selectFrom('experiment_version')
    .selectAll()
    .where('experiment_id', '=', experimentId)
    .where('deleted_at', 'is', null)
    .where('status', 'in', ['published', 'archived'])
    .orderBy('version_number', 'desc')
    .executeTakeFirst();
  if (!version) return [];

  const fields: FieldDef[] = await db
    .selectFrom('metadata_field_def as f')
    .leftJoin('metadata_template as t', 't.id', 'f.template_id')
    .select(['f.key', 'f.scope'])
    .where('f.searchable', '=', true)
    .where('f.deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('f.experiment_version_id', '=', version.id),
        eb.and([
          eb('t.assay_type', '=', experiment.assay_type),
          eb('t.version', '=', version.template_version),
          eb('t.deleted_at', 'is', null),
        ]),
      ]),
    )
    .execute();
  const sampleFields = fields.filter((f) => f.scope === 'sample').map((f) => f.key);
  const experimentFields = fields.filter((f) => f.scope === 'experiment').map((f) => f.key);

  const samples = await db
    .selectFrom('sample')
    .select(['id', 'sample_key', 'source_name', 'characteristics', 'factors', 'technical', 'custom'])
    .where('experiment_version_id', '=', version.id)
    .where('deleted_at', 'is', null)
    .orderBy('sample_key')
    .execute();
  const rawValue = (s: (typeof samples)[number], key: string): Json => {
    if ((SAMPLE_COLUMNS as readonly string[]).includes(key)) return s[key as (typeof SAMPLE_COLUMNS)[number]];
    for (const bag of SAMPLE_BAGS) {
      const v = (s[bag] as Record<string, Json> | null)?.[key];
      if (v !== undefined) return v;
    }
    return undefined;
  };

  // Ontology terms used anywhere in the indexed values, for synonym expansion.
  const termIds = new Set<string>();
  if (isTerm(version.species)) termIds.add(version.species.id);
  const samplesCompounds = new Set<string>();
  for (const s of samples)
    for (const key of sampleFields) {
      const v = rawValue(s, key);
      if (isTerm(v)) termIds.add(v.id);
    }
  for (const s of samples) {
    const c = valueText(rawValue(s, 'compound_id'));
    if (c) samplesCompounds.add(c);
  }
  const synonyms = await synonymsOf(db, [...termIds]);
  const knownCompounds = samplesCompounds.size
    ? await db
        .selectFrom('compound')
        .select(['compound_id', 'name', 'program_id'])
        .where('compound_id', 'in', [...samplesCompounds])
        .where('deleted_at', 'is', null)
        .execute()
    : [];
  const compoundIds = new Set(knownCompounds.map((c) => c.compound_id));
  // Compound names only from the experiment's own program (another program's registry is not shown here).
  const compoundName = new Map(
    knownCompounds
      .filter((c) => c.program_id === experiment.program_id && c.name)
      .map((c) => [c.compound_id, c.name!]),
  );

  const termExpansions = (ids: Iterable<string>) => [...ids].flatMap((id) => synonyms.get(id) ?? []);
  const speciesLabel = isTerm(version.species) ? version.species.label : undefined;
  const assayLabel = experiment.assay_label ?? experiment.assay_type;
  const custom = (version.custom ?? {}) as Record<string, Json>;
  const timePoints = Array.isArray(version.time_points) ? (version.time_points as Json[]).map(valueText) : [];

  const sampleDocs = samples.map((s) => {
    const values = sampleFields.map((key) => rawValue(s, key));
    const compound = valueText(rawValue(s, 'compound_id'));
    const ids = values.filter(isTerm).map((t) => t.id);
    const organism = values.find((v, i) => sampleFields[i] === 'organism');
    return {
      sample: s,
      texts: uniq(values.map(valueText)),
      compound: compound && compoundIds.has(compound) ? compound : undefined,
      compoundName: compound ? compoundName.get(compound) : undefined,
      species: isTerm(organism) ? organism.label : speciesLabel,
      expansions: termExpansions(ids),
    };
  });

  const species = uniq([speciesLabel, ...sampleDocs.map((d) => d.species)]);
  const compounds = uniq(sampleDocs.map((d) => d.compound)).sort();
  const base = {
    tenant_id: experiment.tenant_id,
    created_by: actor,
    experiment_id: experiment.id,
    experiment_version_id: version.id,
    program_id: experiment.program_id,
    assay_type: experiment.assay_type,
    status: version.status,
  };
  const doc = (
    entity: { entity_type: 'experiment' | 'sample'; entity_id: string },
    title: string,
    subtitle: string,
    bodyParts: (string | undefined)[],
    expansionParts: string[],
    facets: { species: string[]; compounds: string[] },
  ) => {
    const body = uniq(bodyParts).join(' · ');
    const expansions = uniq([...expansionParts, ...dehyphenated(`${title} ${subtitle} ${body}`)]).join(' ');
    return {
      ...base,
      ...entity,
      ...facets,
      title,
      subtitle,
      body,
      expansions,
      content_hash: hash(title, subtitle, body, expansions),
    };
  };

  const rows = [
    doc(
      { entity_type: 'experiment', entity_id: version.id },
      experiment.name,
      `${experiment.program_code} · ${assayLabel} · v${version.version_number}`,
      [
        version.description,
        experiment.program_name,
        assayLabel,
        speciesLabel,
        version.spectral_library ?? undefined,
        ...timePoints,
        ...experimentFields.map((k) => valueText(custom[k])),
        ...sampleDocs.flatMap((d) => d.texts.filter((t) => t !== d.sample.sample_key)),
        ...sampleDocs.map((d) => d.compoundName),
      ],
      [...termExpansions(termIds)],
      { species, compounds },
    ),
    ...sampleDocs.map((d) =>
      doc(
        { entity_type: 'sample', entity_id: d.sample.id },
        d.sample.sample_key,
        experiment.name,
        [...d.texts, d.compoundName],
        d.expansions,
        { species: uniq([d.species]), compounds: uniq([d.compound]) },
      ),
    ),
  ];
  return rows;
}

/** Rebuilds every experiment's documents (seed, admin reindex); returns the number of live documents. */
export async function reindexAll(db: Database, actor: string): Promise<number> {
  const experiments = await db.selectFrom('experiment').select('id').execute();
  let total = 0;
  for (const { id } of experiments) {
    total += await db
      .transaction()
      .execute((trx) => reindexExperiment(trx as unknown as Database, id, actor));
  }
  return total;
}
