/** Splits an API snippet (matches wrapped in \u0001…\u0002, never HTML) into plain and highlighted parts. */
export function snippetParts(snippet: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  for (const [i, chunk] of snippet.split('\u0001').entries()) {
    if (i === 0) {
      if (chunk) parts.push({ text: chunk.replaceAll('\u0002', ''), mark: false });
      continue;
    }
    const [marked = '', ...rest] = chunk.split('\u0002');
    if (marked) parts.push({ text: marked, mark: true });
    const tail = rest.join('');
    if (tail) parts.push({ text: tail, mark: false });
  }
  return parts;
}

/** Comma-separated facet values in the URL ⇄ arrays for the API. */
export const splitList = (v: string | undefined): string[] => (v ? v.split(',').filter(Boolean) : []);
export const joinList = (values: string[]): string | undefined =>
  values.length ? values.join(',') : undefined;
