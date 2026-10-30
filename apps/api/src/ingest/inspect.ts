import type { Compression, FileFormat, QcCheck } from '@tributary/contracts';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createGunzip, type Gunzip } from 'node:zlib';
import { qcChecks } from './qc.ts';
import { GZIP_MAGIC, sniff, type Detection } from './sniff.ts';

export interface Inspection {
  sha256: string;
  size_bytes: number;
  format: FileFormat;
  compression: Compression;
  detected_by: Detection['detected_by'];
  checks: QcCheck[];
  passed: boolean;
}

const HEAD_BYTES = 64 * 1024;
// Enough for a zip end-of-central-directory record with the longest comment (APPNOTE §4.3.16) or a Parquet footer tail.
const TAIL_BYTES = 64 * 1024 + 22;

/** Decompresses a stream to nowhere, only to verify it; resolves to the first zlib error, if any. */
class GzipVerifier {
  readonly #gunzip: Gunzip = createGunzip();
  #error: Error | undefined;
  readonly #ended: Promise<void>;

  constructor() {
    this.#gunzip.on('data', () => undefined);
    this.#gunzip.on('error', (error) => (this.#error ??= error));
    this.#ended = new Promise((resolve) => {
      this.#gunzip.on('end', resolve);
      this.#gunzip.on('error', () => resolve());
    });
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.#error) return;
    if (!this.#gunzip.write(chunk)) await Promise.race([once(this.#gunzip, 'drain'), this.#ended]);
  }

  async end(): Promise<Error | undefined> {
    if (!this.#error) this.#gunzip.end();
    await this.#ended;
    return this.#error;
  }
}

/**
 * Streams an object once: sha256 and size over every byte, format detection on the head, full decompression for
 * gzip/BGZF, and QC on head and tail. Memory stays bounded by HEAD_BYTES + TAIL_BYTES.
 */
export async function inspectObject(chunks: AsyncIterable<Uint8Array>, name: string): Promise<Inspection> {
  const hash = createHash('sha256');
  let size = 0;
  const pending: Uint8Array[] = [];
  let head: Uint8Array | undefined;
  let tail: Uint8Array = new Uint8Array();
  let verifier: GzipVerifier | undefined;

  const start = async (headBytes: Uint8Array) => {
    head = headBytes;
    if (GZIP_MAGIC.every((b, i) => headBytes[i] === b)) verifier = new GzipVerifier();
    for (const chunk of pending) await verifier?.write(chunk);
    pending.length = 0;
  };

  for await (const raw of chunks) {
    const chunk = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    hash.update(chunk);
    size += chunk.length;
    tail = keepTail(tail, chunk);
    if (head) {
      await verifier?.write(chunk);
      continue;
    }
    pending.push(chunk);
    if (size >= HEAD_BYTES) await start(Buffer.concat(pending).subarray(0, HEAD_BYTES));
  }
  const complete = !head;
  if (!head) await start(new Uint8Array(Buffer.concat(pending)));
  const detection = sniff(head!, name, complete);
  const gzipError = await verifier?.end();
  const checks = qcChecks({ detection, size, tail, complete, gzipError });
  return {
    sha256: hash.digest('hex'),
    size_bytes: size,
    format: detection.format,
    compression: detection.compression,
    detected_by: detection.detected_by,
    checks,
    passed: checks.every((c) => c.passed),
  };
}

function keepTail(tail: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (chunk.length >= TAIL_BYTES) return chunk.slice(chunk.length - TAIL_BYTES);
  const joined = Buffer.concat([tail, chunk]);
  return new Uint8Array(joined.subarray(Math.max(0, joined.length - TAIL_BYTES)));
}
