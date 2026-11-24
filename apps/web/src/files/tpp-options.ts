// TPP-TR import options (Phase 46): the label → temperature table typed or pasted by the user.

export interface TppDraft {
  compound_id: string;
  feature_type: '' | 'gene' | 'protein_group';
  temperatures: string;
}

/** "126 37" per line (space, tab, comma, = or : between label and °C). Returns the map, or what is wrong. */
export function parseTemperatures(text: string): { map: Record<string, number> } | { error: string } {
  const map: Record<string, number> = {};
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { error: 'One line per label: the label, then its temperature in °C.' };
  for (const line of lines) {
    const parts = line.split(/[\s,=:]+/).filter(Boolean);
    const value = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(value))
      return { error: `“${line}” is not a label followed by a temperature.` };
    if (value < 0 || value > 100) return { error: `“${line}”: temperatures are in °C (0–100).` };
    if (parts[0]! in map) return { error: `Label ${parts[0]} appears twice.` };
    map[parts[0]!] = value;
  }
  return { map };
}

export function tppOptions(d: TppDraft): Record<string, unknown> | null {
  const t = parseTemperatures(d.temperatures);
  if ('error' in t || !d.compound_id.trim() || !d.feature_type) return null;
  return { compound_id: d.compound_id.trim(), feature_type: d.feature_type, temperatures: t.map };
}
