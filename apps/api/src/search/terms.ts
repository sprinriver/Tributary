/**
 * Words of a search query (letters and digits, joined hyphens kept), lower-cased, plus the de-hyphenated form of
 * hyphenated words (the indexer stores both). Never SQL: each term is bound as a parameter of plainto_tsquery.
 */
export function queryTerms(q: string): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
  const out: string[] = [];
  for (const raw of words.slice(0, 16)) {
    const word = raw.slice(0, 64);
    out.push(word);
    if (word.includes('-')) out.push(word.replaceAll('-', ''));
  }
  return [...new Set(out)];
}

/** Word n-grams (1–4 words) of a query, for matching multi-word ontology synonyms ("human embryonic kidney"). */
export function phrases(q: string): string[] {
  const words =
    q
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu)
      ?.slice(0, 16) ?? [];
  const out = new Set<string>();
  for (let n = 1; n <= 4; n++)
    for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return [...out];
}
