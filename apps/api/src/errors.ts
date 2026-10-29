import { issuesToErrors, type ContractError } from '@tributary/contracts';
import { IMMUTABLE_SQLSTATE } from '@tributary/db';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, type z } from 'zod';

/** An error with an HTTP status and the `{code, field?, message}` body (API contract rules). */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly body: ContractError & { errors?: ContractError[] };

  constructor(statusCode: number, code: string, message: string, field?: string, errors?: ContractError[]) {
    super(message);
    this.statusCode = statusCode;
    this.body = { code, message, ...(field ? { field } : {}), ...(errors ? { errors } : {}) };
  }
}

export const unauthenticated = () =>
  new HttpError(401, 'unauthenticated', 'Sign in or send a valid access token.');
export const forbidden = (message = 'You do not have permission to do this.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`);

/** Parses a request part with a contracts schema; a failure becomes a 400 with field-level errors. */
export function parse<S extends z.ZodType>(schema: S, value: unknown, prefix?: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const errors = issuesToErrors(result.error.issues).map((e) =>
    prefix && e.field ? { ...e, field: `${prefix}.${e.field}` } : e,
  );
  const first = errors[0];
  throw new HttpError(
    400,
    first?.code ?? 'invalid',
    first?.message ?? 'Invalid request',
    first?.field,
    errors,
  );
}

interface PgError {
  code?: string;
  message: string;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError | ZodError | PgError, request, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send(error.body);
    if (error instanceof ZodError) {
      const errors = issuesToErrors(error.issues);
      return reply
        .status(400)
        .send({ ...(errors[0] ?? { code: 'invalid', message: 'Invalid request' }), errors });
    }
    const code = (error as PgError).code;
    if (code === IMMUTABLE_SQLSTATE) {
      return reply.status(409).send({ code: 'immutable', message: error.message });
    }
    if (code === '23505')
      return reply.status(409).send({ code: 'conflict', message: 'This already exists.' });
    const status = (error as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ code: 'bad_request', message: error.message });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ code: 'internal', message: 'Something went wrong.' });
  });
}
