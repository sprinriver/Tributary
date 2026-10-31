import { HttpError } from '../errors.ts';

/** A data rule failed (rows exist but cannot be drawn): 422 with the field the user should change. */
export const dataError = (code: string, field: string, message: string) =>
  new HttpError(422, code, message, field);
