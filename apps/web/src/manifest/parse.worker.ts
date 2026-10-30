// Parses uploaded manifests off the main thread (SPEC M2).
import { parseTable } from './parse-core.ts';

self.onmessage = (event: MessageEvent<string>) => {
  self.postMessage(parseTable(event.data));
};
