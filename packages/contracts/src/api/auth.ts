import { z } from 'zod';
import { TimestampSchema, UuidV7Schema } from '../common.ts';

export const RoleSchema = z.enum(['viewer', 'contributor', 'approver', 'admin', 'system_admin']);

export const MeResponseSchema = z
  .object({
    user: z.object({ id: z.uuid(), name: z.string(), email: z.string(), kind: z.enum(['human', 'service']) }),
    roles: z.array(
      z.object({ program_id: z.uuid().nullable(), program_code: z.string().nullable(), role: RoleSchema }),
    ),
    auth: z.enum(['session', 'token']),
    /** Present for cookie sessions: send it as `X-CSRF-Token` on every mutation. */
    csrf_token: z.string().optional(),
  })
  .meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const CreateTokenBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(z.enum(['read', 'write'])).min(1),
    expires_in_days: z.int().min(1).max(365),
  })
  .meta({ id: 'CreateTokenBody' });

export const AccessTokenSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    token_prefix: z.string(),
    scopes: z.array(z.enum(['read', 'write'])),
    expires_at: TimestampSchema,
    revoked_at: TimestampSchema.nullable(),
    last_used_at: TimestampSchema.nullable(),
    created_at: TimestampSchema,
  })
  .meta({ id: 'AccessToken' });

export const CreatedTokenSchema = z
  .object({ id: UuidV7Schema, token: z.string(), token_prefix: z.string(), expires_at: TimestampSchema })
  .meta({ id: 'CreatedToken' });

export const LogoutResponseSchema = z.object({ logout_url: z.url() }).meta({ id: 'LogoutResponse' });
