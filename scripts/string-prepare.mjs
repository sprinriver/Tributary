// Converts STRING download files to Tributary's interaction text (Phase 45, PPI-01), without any dependency.
//
//   node scripts/string-prepare.mjs <protein.links.txt[.gz]> <protein.info.txt[.gz]> [min_score=700] > string.tsv
//
// Formats (https://stringdb-downloads.org, v12.0; checked 2026-11-10):
// - <taxon>.protein.links.v12.0.txt: space-separated, header "protein1 protein2 combined_score"; IDs such as
//   9606.ENSP00000000233; the combined score is a probability × 1000; each pair appears in both directions.
// - <taxon>.protein.info.v12.0.txt: tab-separated, header "#string_protein_id preferred_name protein_size annotation".
// Output: "gene<TAB>gene<TAB>score", one line per pair, by STRING's preferred names, sorted.
// STRING data is CC BY 4.0: cite STRING and record the version and score threshold when importing.
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createGunzip, gunzipSync } from 'node:zlib';

function names(infoText) {
  const map = new Map();
  for (const line of infoText.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const [id, name] = line.split('\t');
    if (id && name) map.set(id, name);
  }
  return map;
}

/** A whole number from 0 to 1000 (default 700). */
export function parseMinScore(text) {
  if (text === undefined) return 700;
  if (!/^\d+$/.test(text) || Number(text) > 1000)
    throw new Error(`min_score must be a whole number from 0 to 1000 (700 = STRING's 0.7), got "${text}"`);
  return Number(text);
}

function collector(nameOf, minScore) {
  // name pair → { score, ids: the first STRING ID pair seen, merged: another ID pair mapped to the same names }
  const pairs = new Map();
  const sameName = new Set();
  const seen = new Map();
  for (const name of nameOf.values()) seen.set(name, (seen.get(name) ?? 0) + 1);
  const counts = {
    pairs: 0,
    rowsBelowScore: 0,
    rowsUnmapped: 0,
    // Preferred names carried by more than one STRING protein.
    sharedNames: [...seen.values()].filter((n) => n > 1).length,
    // Pairs of two different proteins with one name (dropped: they would be a self-pair).
    sameNamePairs: 0,
    // Name pairs that more than one protein pair mapped to (the highest score is kept).
    mergedPairs: 0,
  };
  return {
    add(line) {
      if (line === '' || line.startsWith('protein1')) return;
      const [p1, p2, s] = line.split(' ');
      const score = Number(s);
      // The file lists each pair in both directions; a pair listed once is kept too (pairs merge below).
      if (score < minScore) {
        counts.rowsBelowScore += 1;
        return;
      }
      const [a, b] = [nameOf.get(p1), nameOf.get(p2)];
      if (!a || !b) {
        counts.rowsUnmapped += 1;
        return;
      }
      const ids = p1 < p2 ? `${p1} ${p2}` : `${p2} ${p1}`;
      if (a === b) {
        if (p1 !== p2) sameName.add(ids);
        return;
      }
      const key = a < b ? `${a}\t${b}` : `${b}\t${a}`;
      const entry = pairs.get(key);
      if (!entry) pairs.set(key, { score, ids, merged: false });
      else {
        if (entry.ids !== ids) entry.merged = true;
        if (score > entry.score) entry.score = score;
      }
    },
    result() {
      const lines = [...pairs]
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, v]) => `${k}\t${v.score}`);
      counts.pairs = lines.length;
      counts.sameNamePairs = sameName.size;
      counts.mergedPairs = [...pairs.values()].filter((v) => v.merged).length;
      return { tsv: lines.length ? `${lines.join('\n')}\n` : '', counts };
    },
  };
}

/** In-memory conversion (tests, small files). */
export function stringToTsv(linksText, infoText, minScore = 700) {
  const c = collector(names(infoText), minScore);
  for (const line of linksText.split(/\r?\n/)) c.add(line);
  return c.result();
}

const text = (path) => {
  const bytes = readFileSync(path);
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [links, info, min] = process.argv.slice(2);
  if (!links || !info) {
    console.error(
      'usage: node scripts/string-prepare.mjs <protein.links> <protein.info> [min_score=700] > out.tsv',
    );
    process.exit(2);
  }
  let minScore;
  try {
    minScore = parseMinScore(min);
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }
  // The links file has millions of lines: read it as a stream.
  const c = collector(names(text(info)), minScore);
  const stream = createReadStream(links);
  const rl = createInterface({ input: links.endsWith('.gz') ? stream.pipe(createGunzip()) : stream });
  for await (const line of rl) c.add(line);
  const out = c.result();
  process.stdout.write(out.tsv);
  const n = out.counts;
  console.error(
    [
      `string-prepare: ${n.pairs} pairs at score ≥ ${minScore}.`,
      `Rows left out: ${n.rowsBelowScore} below the score, ${n.rowsUnmapped} with an ID missing from protein.info.`,
      `Preferred names: ${n.sharedNames} are shared by several proteins; ${n.sameNamePairs} pairs of two proteins with one name were dropped; ${n.mergedPairs} pairs merged (highest score kept).`,
      'Record the STRING version, this score and these counts in source_release or your import reason.',
      'Some preferred names are not gene symbols (e.g. Ensembl IDs): they cannot match gene names in results.',
    ].join('\n'),
  );
}
