// GMT gene-set files (Broad GSEA format; used by Reactome, g:Profiler and GO tooling): one set per line,
// "id<TAB>description<TAB>member<TAB>member…". Nothing is guessed: malformed lines are reported with their number.

export interface ParsedGeneSet {
  id: string;
  name: string;
  members: string[];
}

export function parseGmt(text: string): {
  sets: ParsedGeneSet[];
  errors: { line: number; message: string }[];
} {
  const sets: ParsedGeneSet[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '') return;
    const line = index + 1;
    const [id = '', description = '', ...rest] = raw.split('\t').map((f) => f.trim());
    const members = [...new Set(rest.filter(Boolean))];
    if (!id || members.length === 0) {
      errors.push({ line, message: 'Needs an id, a description and at least one member.' });
      return;
    }
    if (seen.has(id)) {
      errors.push({ line, message: `Duplicate set id "${id}".` });
      return;
    }
    seen.add(id);
    // Many GMT exports put a URL in the description column: then the id is the best name available.
    const name = !description || /^https?:\/\//i.test(description) ? id : description;
    sets.push({ id, name, members });
  });
  return { sets, errors };
}
