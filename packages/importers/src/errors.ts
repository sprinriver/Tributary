/** A problem with the request or the file as a whole (wrong importer, missing mapping); not a quality rule. */
export class ImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
