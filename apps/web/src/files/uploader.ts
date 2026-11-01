import type { FileRole, FileSummary, InitiateUploadResponse, UploadedParts } from '@tributary/contracts';
import { api } from '../api.ts';

// Browser → S3 presigned multipart upload (SPEC M3): parallel parts, per-part retry with fresh URLs, resume after a
// reload by asking the API which parts are already stored. File bytes never pass through the API.

type Part = { part_number: number; url: string };

export interface UploadDeps {
  initiate(body: {
    experiment_version_id: string;
    name: string;
    size_bytes: number;
    role: FileRole;
  }): Promise<InitiateUploadResponse>;
  listParts(fileId: string): Promise<UploadedParts>;
  signParts(fileId: string, partNumbers: number[]): Promise<Part[]>;
  putPart(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<string>;
  complete(fileId: string, parts: { part_number: number; etag: string }[]): Promise<FileSummary>;
  storage?: Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  sleep?: (ms: number) => Promise<void>;
}

export interface UploadOptions {
  versionId: string;
  role: FileRole;
  /** Parts in flight at once. */
  concurrency?: number;
  /** Extra attempts per part. */
  retries?: number;
  onProgress?: (loaded: number, total: number) => void;
}

type UploadableFile = Blob & { name: string; lastModified: number };

const resumeKey = (versionId: string, file: UploadableFile) =>
  `tributary-upload:${versionId}:${file.name}:${file.size}:${file.lastModified}`;

/** Starts or resumes the upload; resolves with the file once the API has accepted the completed object. */
export async function uploadFile(
  file: UploadableFile,
  options: UploadOptions,
  deps: UploadDeps = browserDeps(),
): Promise<FileSummary> {
  const { concurrency = 4, retries = 3 } = options;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const key = resumeKey(options.versionId, file);

  let fileId: string | undefined;
  let partSize = 0;
  let partCount = 0;
  const etags = new Map<number, string>();
  const previous = deps.storage?.getItem(key);
  if (previous) {
    try {
      const stored = await deps.listParts(previous);
      fileId = previous;
      partSize = stored.part_size;
      partCount = stored.part_count;
      for (const p of stored.parts) {
        const expected = Math.min(partSize, file.size - (p.part_number - 1) * partSize);
        if (p.size_bytes === expected) etags.set(p.part_number, p.etag);
      }
    } catch {
      deps.storage?.removeItem(key); // Finished, aborted or unknown: start again.
    }
  }
  let urls = new Map<number, string>();
  if (!fileId) {
    const started = await deps.initiate({
      experiment_version_id: options.versionId,
      name: file.name,
      size_bytes: file.size,
      role: options.role,
    });
    fileId = started.file.id;
    partSize = started.part_size;
    partCount = started.part_count;
    urls = new Map(started.parts.map((p) => [p.part_number, p.url]));
    deps.storage?.setItem(key, fileId);
  }
  const id = fileId;

  const todo: number[] = [];
  for (let n = 1; n <= partCount; n++) if (!etags.has(n)) todo.push(n);
  for (let i = 0; i < todo.length; i += 1000) {
    const batch = todo.slice(i, i + 1000).filter((n) => !urls.has(n));
    if (batch.length) for (const p of await deps.signParts(id, batch)) urls.set(p.part_number, p.url);
  }

  const loaded = new Map<number, number>();
  for (const n of etags.keys()) loaded.set(n, Math.min(partSize, file.size - (n - 1) * partSize));
  const report = () =>
    options.onProgress?.(
      [...loaded.values()].reduce((a, b) => a + b, 0),
      file.size,
    );
  report();

  const sendPart = async (n: number) => {
    const blob = file.slice((n - 1) * partSize, n * partSize);
    for (let attempt = 0; ; attempt++) {
      try {
        const etag = await deps.putPart(urls.get(n)!, blob, (bytes) => {
          loaded.set(n, bytes);
          report();
        });
        etags.set(n, etag);
        loaded.set(n, blob.size);
        report();
        return;
      } catch (error) {
        loaded.set(n, 0);
        if (attempt >= retries) {
          throw new Error(`Upload of ${file.name} part ${n} failed: ${(error as Error).message}`, {
            cause: error,
          });
        }
        await sleep(500 * 2 ** attempt);
        // The URL may have expired: sign this part again before retrying.
        for (const p of await deps.signParts(id, [n])) urls.set(p.part_number, p.url);
      }
    }
  };

  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) await sendPart(n);
    }),
  );
  const done = await deps.complete(
    id,
    [...etags].sort(([a], [b]) => a - b).map(([part_number, etag]) => ({ part_number, etag })),
  );
  deps.storage?.removeItem(key);
  return done;
}

/** PUT one part with upload progress (XMLHttpRequest reports upload progress; fetch does not). */
function putWithProgress(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader('ETag');
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error(etag ? `HTTP ${xhr.status}` : 'no ETag (check the bucket CORS ExposeHeaders)'));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send(blob);
  });
}

export function browserDeps(): UploadDeps {
  let storage: UploadDeps['storage'];
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    initiate: (body) => api('initiateUpload', { body, reason: 'Browser upload' }),
    listParts: (fileId) => api('listUploadedParts', { params: { id: fileId } }),
    signParts: async (fileId, partNumbers) =>
      (await api('signUploadParts', { params: { id: fileId }, body: { part_numbers: partNumbers } })).parts,
    putPart: putWithProgress,
    complete: (fileId, parts) => api('completeUpload', { params: { id: fileId }, body: { parts } }),
    storage,
  };
}
