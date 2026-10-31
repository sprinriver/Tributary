import { DATASET_CONTRACTS, type DatasetContract, type DatasetKind, type Join } from '@tributary/contracts';
import type { RuleGroupType } from 'react-querybuilder';
import { Field } from '../components/ui.tsx';
import { KindSelect } from './DatasetPicker.tsx';
import { FilterBuilder } from './FilterBuilder.tsx';
import { emptyGroup, fieldsOf } from './spec.ts';

export interface JoinDraft {
  type: Join['type'];
  kind: DatasetKind;
  alias: string;
  on: { left: string; op: Join['on'][number]['op']; right: string }[];
  where: RuleGroupType;
  explode: '' | 'protein_ids' | 'gene_names';
  advanced: boolean;
}

/** A new join to `kind`, on the first join key both contracts declare (SPEC M6: joins on declared keys). */
export function newJoin(primary: DatasetContract, kind: DatasetKind, index: number): JoinDraft {
  const target = DATASET_CONTRACTS[kind];
  const shared = primary.joinKeys.find((k) => target.joinKeys.includes(k));
  const left = shared ?? primary.joinKeys[0] ?? primary.columns[0]!.name;
  const right = shared ?? target.joinKeys[0] ?? target.columns[0]!.name;
  return {
    type: 'left',
    kind,
    alias: `j${index + 1}`,
    on: [{ left, op: '=', right }],
    where: emptyGroup(),
    explode: '',
    advanced: false,
  };
}

const OPS: Join['on'][number]['op'][] = ['=', '!=', '>', '<', 'startsWith'];

export function JoinBuilder({
  index,
  primary,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  primary: DatasetContract;
  value: JoinDraft;
  onChange: (j: JoinDraft) => void;
  onRemove: () => void;
}) {
  const target = DATASET_CONTRACTS[value.kind];
  // Without advanced mode only declared join keys are offered (the API enforces the same rule).
  const leftColumns = value.advanced ? primary.columns.map((c) => c.name) : primary.joinKeys;
  const rightColumns = value.advanced ? target.columns.map((c) => c.name) : target.joinKeys;
  const lists = primary.columns.filter((c) => c.name === 'protein_ids' || c.name === 'gene_names');
  const setOn = (i: number, patch: Partial<JoinDraft['on'][number]>) =>
    onChange({ ...value, on: value.on.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <section role="region" aria-label={`Join ${index + 1}`} className="card stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Join type">
          {(id) => (
            <select
              id={id}
              value={value.type}
              onChange={(e) => onChange({ ...value, type: e.target.value as Join['type'] })}
            >
              <option value="inner">inner</option>
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          )}
        </Field>
        <Field label="Join dataset kind">
          {(id) => (
            <KindSelect
              id={id}
              value={value.kind}
              onChange={(kind) =>
                onChange({ ...newJoin(primary, kind, index), type: value.type, alias: value.alias })
              }
            />
          )}
        </Field>
        <Field label="Alias">
          {(id) => (
            <input
              id={id}
              value={value.alias}
              pattern="[a-z][a-z0-9_]*"
              onChange={(e) => onChange({ ...value, alias: e.target.value.toLowerCase() })}
              style={{ width: 80 }}
            />
          )}
        </Field>
        {lists.length > 0 && (
          <Field label="Explode">
            {(id) => (
              <select
                id={id}
                value={value.explode}
                onChange={(e) => onChange({ ...value, explode: e.target.value as JoinDraft['explode'] })}
              >
                <option value="">no</option>
                {lists.map((c) => (
                  <option key={c.name} value={c.name}>
                    one row per {c.name === 'protein_ids' ? 'accession' : 'gene'}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={value.advanced}
            onChange={(e) => onChange({ ...value, advanced: e.target.checked })}
          />
          Advanced (any columns)
        </label>
        <button type="button" onClick={onRemove}>
          Remove join
        </button>
      </div>
      {value.on.map((c, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Left column">
            {(id) => (
              <select id={id} value={c.left} onChange={(e) => setOn(i, { left: e.target.value })}>
                {leftColumns.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Operator">
            {(id) => (
              <select
                id={id}
                value={c.op}
                disabled={!value.advanced}
                onChange={(e) => setOn(i, { op: e.target.value as JoinDraft['on'][number]['op'] })}
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Right column">
            {(id) => (
              <select id={id} value={c.right} onChange={(e) => setOn(i, { right: e.target.value })}>
                {rightColumns.map((n) => (
                  <option key={n} value={n}>
                    {value.alias}.{n}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {value.on.length > 1 && (
            <button
              type="button"
              onClick={() => onChange({ ...value, on: value.on.filter((_, j) => j !== i) })}
            >
              Remove condition
            </button>
          )}
        </div>
      ))}
      <div>
        <button type="button" onClick={() => onChange({ ...value, on: [...value.on, { ...value.on[0]! }] })}>
          Add condition
        </button>
      </div>
      <FilterBuilder
        label={`Join ${index + 1} filters`}
        fields={fieldsOf(target)}
        query={value.where}
        onChange={(where) => onChange({ ...value, where })}
      />
    </section>
  );
}
