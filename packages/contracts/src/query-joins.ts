import type { ContractError } from './errors.ts';
import type { QuerySpec } from './query.ts';
import type { ContractResolver } from './query-validate.ts';

/**
 * Join rules beyond column existence (ARCHITECTURE §6): without advanced mode a join uses `=` on keys both
 * contracts declare; advanced mode needs a role allowed to use it; at most one explode per query.
 * Run after validateQuerySpec, which reports unknown columns and aliases.
 */
export function checkJoinKeys(
  spec: QuerySpec,
  resolve: ContractResolver,
  options: { advancedAllowed: boolean },
): ContractError[] {
  const errors: ContractError[] = [];
  const fail = (field: string, code: string, message: string) => errors.push({ code, field, message });
  const base = resolve(spec.source);
  if (!base) return errors;
  const aliases = new Map<string, NonNullable<ReturnType<ContractResolver>>>();
  let explodes = 0;

  spec.joins?.forEach((join, i) => {
    const path = `joins.${i}`;
    const target = resolve(join.target);
    if (join.explode && ++explodes > 1)
      fail(`${path}.explode`, 'one_explode', 'Only one join per query can explode a list column.');
    if (join.advanced) {
      if (!options.advancedAllowed)
        fail(`${path}.advanced`, 'advanced_forbidden', 'Advanced joins need a contributor role or higher.');
      if (target) aliases.set(join.alias, target);
      return;
    }
    join.on.forEach((condition, j) => {
      for (const side of ['left', 'right'] as const) {
        const [first, second] = condition[side].split('.');
        const contract =
          second === undefined ? base : first === join.alias ? target : aliases.get(first ?? '');
        const name = second ?? first ?? '';
        if (contract && !contract.joinKeys.includes(name)) {
          fail(
            `${path}.on.${j}.${side}`,
            'not_join_key',
            `"${condition[side]}" is not a declared join key of ${contract.kind}; use advanced mode.`,
          );
        }
      }
      if (condition.op !== '=')
        fail(`${path}.on.${j}.op`, 'advanced_required', `"${condition.op}" joins need advanced mode.`);
    });
    if (target) aliases.set(join.alias, target);
  });
  return errors;
}
