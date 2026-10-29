import {
  SEED_PROTEOMICS_TEMPLATE,
  type AssayTypeKey,
  type MetadataFieldDef,
  type MetadataTemplateDefinition,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';

export interface ResolvedTemplate extends MetadataTemplateDefinition {
  built_in: boolean;
}

const builtIn = (assayType: AssayTypeKey): ResolvedTemplate => ({
  ...SEED_PROTEOMICS_TEMPLATE,
  assay_type: assayType,
  built_in: true,
});

const semverKey = (v: string) =>
  v
    .split('.')
    .map((n) => n.padStart(6, '0'))
    .join('.');

/** Templates stored in Postgres, newest version first; the built-in seed template when none exist (SPEC §6.1). */
export async function listTemplates(db: Database, assayType?: AssayTypeKey): Promise<ResolvedTemplate[]> {
  let query = db
    .selectFrom('metadata_template')
    .select(['id', 'assay_type', 'version', 'status', 'key_field'])
    .where('deleted_at', 'is', null);
  if (assayType) query = query.where('assay_type', '=', assayType);
  const templates = await query.execute();
  const fields = templates.length
    ? await db
        .selectFrom('metadata_field_def')
        .selectAll()
        .where(
          'template_id',
          'in',
          templates.map((t) => t.id),
        )
        .where('deleted_at', 'is', null)
        .orderBy('position')
        .execute()
    : [];
  const resolved = templates
    .map((t) => ({
      assay_type: t.assay_type,
      version: t.version,
      status: t.status as ResolvedTemplate['status'],
      key_field: t.key_field,
      built_in: false,
      fields: fields.filter((f) => f.template_id === t.id).map(rowToField),
    }))
    .sort((a, b) => semverKey(b.version).localeCompare(semverKey(a.version)));
  if (assayType && !resolved.length) return [builtIn(assayType)];
  return resolved;
}

/** The newest published template for an assay type (pinned on new experiments). */
export async function currentTemplate(db: Database, assayType: AssayTypeKey): Promise<ResolvedTemplate> {
  const all = await listTemplates(db, assayType);
  return all.find((t) => t.status === 'published') ?? all[0] ?? builtIn(assayType);
}

/** The exact template version a version pinned. */
export async function pinnedTemplate(
  db: Database,
  assayType: AssayTypeKey,
  version: string,
): Promise<ResolvedTemplate> {
  const all = await listTemplates(db, assayType);
  return all.find((t) => t.version === version) ?? builtIn(assayType);
}

type FieldRow = {
  scope: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  searchable: boolean;
  unit: string | null;
  ontology: string | null;
  enum_values: string[] | null;
  quantity_kind: string | null;
  validator: string | null;
};

export function rowToField(row: FieldRow): MetadataFieldDef {
  return {
    scope: row.scope as MetadataFieldDef['scope'],
    key: row.key,
    label: row.label,
    type: row.type as MetadataFieldDef['type'],
    required: row.required,
    searchable: row.searchable,
    ...(row.unit ? { unit: row.unit } : {}),
    ...(row.ontology ? { ontology: row.ontology } : {}),
    ...(row.enum_values ? { enumValues: row.enum_values } : {}),
    ...(row.quantity_kind ? { quantityKind: row.quantity_kind as 'concentration' | 'time' } : {}),
    ...(row.validator ? { validator: row.validator as 'plate_well' } : {}),
  };
}

export function fieldToRow(field: MetadataFieldDef, position: number) {
  return {
    position,
    scope: field.scope,
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    searchable: field.searchable,
    unit: field.unit ?? null,
    ontology: field.ontology ?? null,
    enum_values: field.enumValues ?? null,
    quantity_kind: field.quantityKind ?? null,
    validator: field.validator ?? null,
  };
}
