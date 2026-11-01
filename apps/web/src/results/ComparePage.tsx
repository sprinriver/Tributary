import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { FigureView } from './ChartView.tsx';

/** SPEC M8 comparison: 2–6 contrasts → log2 FC scatter, overlap table and UpSet-style intersection bars. */
export function ComparePage() {
  const options = useQuery({ queryKey: ['compare-options'], queryFn: () => api('listCompareOptions') });
  const [chosen, setChosen] = useState<string[]>([]);
  const [fc, setFc] = useState(1);
  const [p, setP] = useState(0.05);
  const key = (o: { release_id: string; contrast_id: string }) => `${o.release_id}/${o.contrast_id}`;
  const compare = useMutation({
    mutationFn: () =>
      api('compareContrasts', {
        body: {
          contrasts: chosen.map((k) => ({ release_id: k.split('/')[0]!, contrast_id: k.split('/')[1]! })),
          fc_threshold: fc,
          p_threshold: p,
        },
      }),
  });
  const r = compare.data;
  return (
    <main style={{ padding: 24 }} className="stack">
      <h1 style={{ margin: 0 }}>Compare contrasts</h1>
      <fieldset style={{ maxHeight: 260, overflow: 'auto' }}>
        <legend>Contrasts (pick 2–6)</legend>
        {options.data?.items.map((o) => (
          <label key={key(o)} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={chosen.includes(key(o))}
              onChange={(e) =>
                setChosen((c) => (e.target.checked ? [...c, key(o)] : c.filter((x) => x !== key(o))))
              }
            />{' '}
            {o.experiment_name} · {o.label} ({o.program_code})
          </label>
        ))}
      </fieldset>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="|log2 FC| at least">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              step="any"
              value={fc}
              onChange={(e) => setFc(Number(e.target.value))}
            />
          )}
        </Field>
        <Field label="Adjusted p at most">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              max={1}
              step="any"
              value={p}
              onChange={(e) => setP(Number(e.target.value))}
            />
          )}
        </Field>
        <button
          type="button"
          className="primary"
          disabled={chosen.length < 2 || chosen.length > 6 || compare.isPending}
          onClick={() => compare.mutate()}
        >
          Compare
        </button>
      </div>
      <ErrorMessage error={options.error ?? compare.error} />
      {r && (
        <>
          <section role="region" aria-label="log2 fold change scatter" className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
              log2 fold change: {r.labels[0]} vs {r.labels[1]}
            </h2>
            <FigureView label="log2 fold change scatter" figure={r.scatter} />
          </section>
          <section role="region" aria-label="Intersections" className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Hits shared between contrasts</h2>
            <FigureView label="Intersection bars" figure={r.upset} />
          </section>
          <section className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
              Overlap ({r.overlap.length} features significant in at least one)
            </h2>
            <table aria-label="Overlap" className="data-table">
              <thead>
                <tr>
                  <th scope="col">feature</th>
                  <th scope="col">genes</th>
                  {r.labels.map((l) => (
                    <th key={l} scope="col">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.overlap.slice(0, 500).map((row) => (
                  <tr key={row.feature_id}>
                    <td>{row.feature_id}</td>
                    <td>{row.gene}</td>
                    {row.log2_fc.map((v, i) => (
                      <td key={i} style={{ fontWeight: row.significant[i] ? 700 : 400 }}>
                        {v === null ? '' : v.toPrecision(3)}
                        {row.significant[i] ? ' ●' : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
