import { parseTable, type ParsedTable } from './parse-core.ts';

/** Parses text in a Web Worker; falls back to the main thread where workers are unavailable (tests, old browsers). */
export function parseInWorker(text: string): Promise<ParsedTable> {
  if (typeof Worker === 'undefined') return Promise.resolve(parseTable(text));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ParsedTable>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || 'Could not parse the file.'));
      worker.terminate();
    };
    worker.postMessage(text);
  });
}
