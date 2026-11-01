import type { CurationSuggestResponse, CurationSuggestion } from '@tributary/contracts';
import type { ToolContext } from './tools.ts';

interface LookupResult {
  source: 'ols' | 'cache' | 'local';
  items: { id: string; label: string; synonyms: string[] }[];
}

/** Words that describe a sample rather than name a term ("HeLa cells", "A549 cell line"). */
const FILLER = /\b(cells?|cell lines?|lines?|culture|sample)\b/gi;
const clean = (value: string) => value.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
/** Case, spaces and punctuation do not matter when comparing names ("MCF7" = "MCF-7"). */
export const normalise = (value: string) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Ontology terms for free-text values (SPEC §11.5). Every term comes from the platform's ontology lookup run as the
 * user (OLS4, its cache or the built-in terms); a value is matched only when a returned label or synonym equals it.
 * Otherwise the answer is "no match", with the lookup's results offered as candidates. Nothing is invented.
 */
export async function suggestTerms(
  ctx: ToolContext,
  ontology: string,
  values: string[],
): Promise<CurationSuggestResponse> {
  const sources = new Set<LookupResult['source']>();
  const items: CurationSuggestion[] = [];
  for (const value of values) {
    const q = clean(value) || value;
    const found = (await ctx.call(
      'GET',
      `/v1/ontology/search?${new URLSearchParams({ ontology, q })}`,
    )) as LookupResult;
    sources.add(found.source);
    const key = normalise(value);
    const exact = found.items.find((t) => [t.label, ...t.synonyms].some((n) => normalise(n) === key));
    const candidates = found.items
      .filter((t) => t.id !== exact?.id)
      .slice(0, 3)
      .map((t) => ({ id: t.id, label: t.label }));
    items.push({
      value,
      term: exact ? { id: exact.id, label: exact.label } : null,
      candidates,
      note: exact
        ? `Matches ${exact.label} (${exact.id}).`
        : candidates.length
          ? `No match; ${candidates.length} lookup result${candidates.length > 1 ? 's' : ''} to check.`
          : `No match in ${ontology}.`,
    });
  }
  return { ontology, sources: [...sources], items };
}
