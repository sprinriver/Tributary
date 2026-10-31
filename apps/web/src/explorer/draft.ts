import { DATASET_CONTRACTS, type DatasetKind, type QuerySpec, type SourceRef } from '@tributary/contracts';
import type { RuleGroupType } from 'react-querybuilder';
import { api } from '../api.ts';
import type { SourceDraft } from './DatasetPicker.tsx';
import type { JoinDraft } from './JoinBuilder.tsx';
import type { Sort } from './ResultsGrid.tsx';
import { columnType, emptyGroup, fromRuleGroup, toRuleGroup } from './spec.ts';

/** Everything the explorer form holds; `buildSpec` turns it into the QuerySpec sent to the API. */
export interface Draft {
  source: SourceDraft;
  joins: JoinDraft[];
  where: RuleGroupType;
  select: string[] | undefined;
  sort: Sort | undefined;
}

export const initialDraft = (): Draft => ({
  source: { kind: 'differential_abundance', releaseId: '', latestOnly: false },
  joins: [],
  where: emptyGroup(),
  select: undefined,
  sort: undefined,
});

/** Column type of `field` or `alias.field` in the draft's sources. */
export function typeIn(draft: Draft, field: string) {
  const [first, second] = field.split('.');
  if (second === undefined) return columnType(DATASET_CONTRACTS[draft.source.kind], first!);
  const join = draft.joins.find((j) => j.alias === first);
  return join ? columnType(DATASET_CONTRACTS[join.kind], second) : undefined;
}

export function buildSpec(draft: Draft): QuerySpec {
  const s = draft.source;
  const source: SourceRef = s.releaseId
    ? { releaseIds: [s.releaseId] }
    : { kind: s.kind, scope: s.latestOnly ? { latestPublishedOnly: true } : {} };
  const where = toRuleGroup(draft.where, (f) => typeIn(draft, f));
  return {
    source,
    ...(draft.joins.length
      ? {
          joins: draft.joins.map((j) => {
            const target = DATASET_CONTRACTS[j.kind];
            const jw = toRuleGroup(j.where, (f) => columnType(target, f));
            return {
              type: j.type,
              target: { kind: j.kind, scope: {} },
              alias: j.alias,
              on: j.on.map((c) => ({ left: c.left, op: c.op, right: `${j.alias}.${c.right}` })),
              ...(jw.rules.length ? { where: jw } : {}),
              ...(j.explode ? { explode: j.explode } : {}),
              ...(j.advanced ? { advanced: true } : {}),
            };
          }),
        }
      : {}),
    ...(where.rules.length ? { where } : {}),
    ...(draft.select ? { select: draft.select } : {}),
    ...(draft.sort ? { orderBy: [{ column: draft.sort.column, dir: draft.sort.dir }] } : {}),
  };
}

async function kindOf(
  ref: SourceRef,
): Promise<{ kind: DatasetKind; releaseId: string; latestOnly: boolean }> {
  if ('kind' in ref) return { kind: ref.kind, releaseId: '', latestOnly: !!ref.scope.latestPublishedOnly };
  const release = await api('getRelease', { params: { id: ref.releaseIds[0]! } });
  return { kind: release.kind, releaseId: ref.releaseIds[0]!, latestOnly: false };
}

/** A saved or linked QuerySpec back into the form (release sources look up their kind). */
export async function draftFromSpec(spec: QuerySpec): Promise<Draft> {
  const source = await kindOf(spec.source);
  const joins = await Promise.all(
    (spec.joins ?? []).map(async (j): Promise<JoinDraft> => {
      const { kind } = await kindOf(j.target);
      return {
        type: j.type,
        kind,
        alias: j.alias,
        on: j.on.map((c) => ({ left: c.left, op: c.op, right: c.right.replace(`${j.alias}.`, '') })),
        where: fromRuleGroup(j.where),
        explode: j.explode ?? '',
        advanced: !!j.advanced,
      };
    }),
  );
  const order = spec.orderBy?.[0];
  return {
    source,
    joins,
    where: fromRuleGroup(spec.where),
    select: spec.select,
    sort: order ? { column: order.column, dir: order.dir } : undefined,
  };
}
