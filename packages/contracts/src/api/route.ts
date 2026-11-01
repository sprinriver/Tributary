import type { z } from 'zod';

export interface ApiRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** OpenAPI-style path, e.g. `/v1/versions/{id}`. */
  path: string;
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  /** Success response (status `status`, default 200); undefined = no body. */
  response?: z.ZodType;
  status?: number;
  /** Sends `X-Change-Reason` (recorded in the audit log). */
  reason?: boolean;
}
