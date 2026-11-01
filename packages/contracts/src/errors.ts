import { z } from 'zod';

/** The one error shape every API, validator and compute endpoint returns, so the UI can show it by the field. */
export const ContractErrorSchema = z
  .object({
    code: z.string().min(1),
    field: z.string().optional(),
    message: z.string().min(1),
  })
  .meta({ id: 'ContractError' });
export type ContractError = z.infer<typeof ContractErrorSchema>;

/** Custom zod issues carry our error code in `params.code`; everything else maps to `invalid`. */
export function issuesToErrors(issues: readonly z.core.$ZodIssue[]): ContractError[] {
  return issues.map((issue) => {
    const params = issue.code === 'custom' ? (issue.params as { code?: unknown } | undefined) : undefined;
    const code = typeof params?.code === 'string' ? params.code : issue.code;
    const field = issue.path.map(String).join('.');
    return field ? { code, field, message: issue.message } : { code, message: issue.message };
  });
}
