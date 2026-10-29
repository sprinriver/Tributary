/** Parses pasted tab-separated text with a header row into raw cell maps (empty lines skipped). */
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const [header, ...rows] = lines;
  if (!header) return [];
  const columns = header.split('\t').map((c) => c.trim());
  return rows.map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? '').trim()]).filter(([c]) => c !== ''));
  });
}
