import { normaliseWell, type PlateFormat } from '@tributary/contracts';
import { useMemo, useState } from 'react';
import { Field } from '../components/ui.tsx';

const FACTORS = ['condition', 'compound_id', 'dose', 'time', 'replicate_group', 'cell_line'] as const;
// Colour-blind-safe categorical palette (Okabe & Ito 2008).
const PALETTE = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999'];
const LAYOUT: Record<PlateFormat, { rows: number; cols: number }> = {
  '96': { rows: 8, cols: 12 },
  '384': { rows: 16, cols: 24 },
};

interface Props {
  rows: { id: string; cells: Record<string, string> }[];
  onSelect: (rowId: string) => void;
}

/** 96/384-well plate coloured by a factor; clicking a well selects its sample (SPEC M2). */
export function PlateView({ rows, onSelect }: Props) {
  const [format, setFormat] = useState<PlateFormat>('96');
  const [factor, setFactor] = useState<string>('condition');
  const [selected, setSelected] = useState<string | null>(null);
  const byWell = useMemo(() => {
    const map = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const well = normaliseWell(row.cells.well ?? '', format);
      if (well && !map.has(well)) map.set(well, row);
    }
    return map;
  }, [rows, format]);
  const values = [...new Set(rows.map((r) => r.cells[factor] ?? '').filter(Boolean))].sort();
  const colour = (value: string) => (value ? PALETTE[values.indexOf(value) % PALETTE.length] : 'transparent');
  const { rows: nRows, cols } = LAYOUT[format];

  return (
    <section role="region" aria-label="Plate layout" className="stack">
      <div className="row">
        <Field label="Plate format">
          {(id) => (
            <select id={id} value={format} onChange={(e) => setFormat(e.target.value as PlateFormat)}>
              <option value="96">96-well</option>
              <option value="384">384-well</option>
            </select>
          )}
        </Field>
        <Field label="Colour by">
          {(id) => (
            <select id={id} value={factor} onChange={(e) => setFactor(e.target.value)}>
              {FACTORS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </Field>
        {selected && <p>Selected: {selected}</p>}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `24px repeat(${cols}, ${format === '96' ? 34 : 22}px)`,
          gap: 3,
        }}
      >
        <span />
        {Array.from({ length: cols }, (_, c) => (
          <span key={c} className="muted" style={{ textAlign: 'center', fontSize: 11 }}>
            {c + 1}
          </span>
        ))}
        {Array.from({ length: nRows }, (_, r) => {
          const letter = String.fromCharCode(65 + r);
          return [
            <span key={letter} className="muted" style={{ fontSize: 11 }}>
              {letter}
            </span>,
            ...Array.from({ length: cols }, (_, c) => {
              const well = `${letter}${String(c + 1).padStart(2, '0')}`;
              const row = byWell.get(well);
              const value = row?.cells[factor] ?? '';
              const key = row?.cells.sample_key ?? '';
              return (
                <button
                  key={well}
                  type="button"
                  aria-label={
                    row ? `Well ${well}: ${key}${value ? ` (${value})` : ''}` : `Well ${well}: empty`
                  }
                  title={row ? `${well} · ${key} · ${value}` : well}
                  disabled={!row}
                  onClick={() => {
                    if (!row) return;
                    setSelected(key);
                    onSelect(row.id);
                  }}
                  style={{
                    width: format === '96' ? 34 : 22,
                    height: format === '96' ? 34 : 22,
                    borderRadius: '50%',
                    padding: 0,
                    background: colour(value),
                    outline: selected && key === selected ? '3px solid var(--fg)' : undefined,
                    opacity: 1,
                  }}
                />
              );
            }),
          ];
        })}
      </div>
      <ul aria-label="Legend" className="row" style={{ listStyle: 'none', padding: 0 }}>
        {values.map((v) => (
          <li key={v} className="row" style={{ gap: 4 }}>
            <span
              aria-hidden="true"
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: colour(v),
                display: 'inline-block',
              }}
            />
            {v}
          </li>
        ))}
      </ul>
    </section>
  );
}
