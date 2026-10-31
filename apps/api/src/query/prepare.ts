import {
  checkJoinKeys,
  DATASET_CONTRACTS,
  validateQuerySpec,
  type ColumnType,
  type ContractError,
  type InternalQueryRequest,
  type QuerySpec,
  type ResolvedSource,
  type SourceRef,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { HttpError } from '../errors.ts';
import { resolveSource } from './resolve.ts';

/** Advanced joins (any key pair or operator) need a role above viewer (ARCHITECTURE §6). */
const canUseAdvanced = (request: FastifyRequest) =>
  requirePrincipal(request).bindings.some((b) => b.role !== 'viewer');

/** Scopes every source to the caller's programs, then validates the spec against the resolved contracts. */
export async function prepare(db: Database, request: FastifyRequest, spec: QuerySpec) {
  const readable = readablePrograms(requirePrincipal(request));
  const refs: SourceRef[] = [spec.source, ...(spec.joins ?? []).map((j) => j.target)];
  const resolved = await Promise.all(refs.map((ref) => resolveSource(db, ref, readable)));
  const byRef = new Map<SourceRef, ResolvedSource>();
  refs.forEach((ref, i) => resolved[i] && byRef.set(ref, resolved[i]));
  const resolve = (ref: SourceRef) => {
    const source = byRef.get(ref);
    return source ? DATASET_CONTRACTS[source.kind] : undefined;
  };
  const errors: ContractError[] = [
    ...validateQuerySpec(spec, resolve),
    ...checkJoinKeys(spec, resolve, { advancedAllowed: canUseAdvanced(request) }),
  ];
  const [first] = errors;
  if (first) throw new HttpError(400, first.code, first.message, first.field, errors);
  const [source, ...joins] = resolved as ResolvedSource[];
  return { source: source!, joins };
}

export const releaseIds = (request: InternalQueryRequest) =>
  [request.source, ...request.joins].flatMap((s) =>
    'releases' in s ? s.releases.map((r) => r.release_id) : [],
  );

/** Column name → type for a spec's sources: bare names of the primary source, `alias.column` for joins. */
export function columnTypes(spec: QuerySpec, sources: { source: ResolvedSource; joins: ResolvedSource[] }) {
  const types: Record<string, ColumnType> = {};
  for (const c of DATASET_CONTRACTS[sources.source.kind].columns) types[c.name] = c.type;
  (spec.joins ?? []).forEach((j, i) => {
    for (const c of DATASET_CONTRACTS[sources.joins[i]!.kind].columns) types[`${j.alias}.${c.name}`] = c.type;
  });
  if (spec.joins?.some((j) => j.explode)) {
    types.explode_value = 'text';
    types.explode_ambiguous = 'boolean';
  }
  return types;
}
