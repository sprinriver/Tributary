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

function collector(nameOf, minScore) {
  const pairs = new Map();
  const counts = { pairs: 0, belowScore: 0, unmapped: 0 };
  return {
    add(line) {
      if (line === '' || line.startsWith('protein1')) return;
      const [p1, p2, s] = line.split(' ');
      const score = Number(s);
      // Each pair is listed in both directions: read it once.
      if (!(p1 < p2)) return;
      if (score < minScore) {
        counts.belowScore += 1;
        return;
      }
      const [a, b] = [nameOf.get(p1), nameOf.get(p2)];
      if (!a || !b) {
        counts.unmapped += 1;
        return;
      }
      if (a === b) return;
      const key = a < b ? `${a}\t${b}` : `${b}\t${a}`;
      if ((pairs.get(key) ?? -1) < score) pairs.set(key, score);
    },
    result() {
      const lines = [...pairs].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, s]) => `${k}\t${s}`);
      counts.pairs = lines.length;
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
  const [links, info, min = '700'] = process.argv.slice(2);
  if (!links || !info) {
    console.error(
      'usage: node scripts/string-prepare.mjs <protein.links> <protein.info> [min_score=700] > out.tsv',
    );
    process.exit(2);
  }
  // The links file has millions of lines: read it as a stream.
  const c = collector(names(text(info)), Number(min));
  const stream = createReadStream(links);
  const rl = createInterface({ input: links.endsWith('.gz') ? stream.pipe(createGunzip()) : stream });
  for await (const line of rl) c.add(line);
  const out = c.result();
  process.stdout.write(out.tsv);
  console.error(
    `string-prepare: ${out.counts.pairs} pairs at score ≥ ${min}; ${out.counts.belowScore} below; ${out.counts.unmapped} lines with an ID missing from protein.info`,
  );
}
