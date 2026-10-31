import {
  DATASET_CONTRACTS,
  QuerySpecSchema,
  type ColumnType,
  type ExportFormat,
  type QuerySpec,
} from '@tributary/contracts';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { ChartPanel } from '../charts/ChartPanel.tsx';
import { ErrorMessage } from '../components/ui.tsx';
import { DatasetPicker } from './DatasetPicker.tsx';
import { CopyCodeDialog, SaveViewDialog } from './dialogs.tsx';
import { buildSpec, draftFromSpec, initialDraft, type Draft } from './draft.ts';
import { FilterBuilder } from './FilterBuilder.tsx';
import { JoinBuilder, newJoin } from './JoinBuilder.tsx';
import { ResultsGrid, type Sort } from './ResultsGrid.tsx';
import { decodeSpec, emptyRules, encodeSpec, fieldsOf } from './spec.ts';

export interface ExplorerSearch {
  q?: string;
  view?: string;
}

const PAGE_SIZE = 25;

/** Column → type for charts: the primary source's columns and `alias.column` for joins (as the API resolves). */
function columnTypesOf(draft: Draft): Record<string, ColumnType> {
  const types: Record<string, ColumnType> = {};
  for (const c of DATASET_CONTRACTS[draft.source.kind].columns) types[c.name] = c.type;
  for (const j of draft.joins)
    for (const c of DATASET_CONTRACTS[j.kind].columns) types[`${j.alias}.${c.name}`] = c.type;
  if (draft.joins.some((j) => j.explode))
    Object.assign(types, { explode_value: 'text', explode_ambiguous: 'boolean' });
  return types;
}

/** SPEC M6 Data Explorer: pick a dataset, filter, join, sort, page, export, save and share. */
export function ExplorerPage() {
  const search = useSearch({ from: '/explore' });
  const navigate = useNavigate({ from: '/explore' });
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [executed, setExecuted] = useState<QuerySpec>();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [dialog, setDialog] = useState<'save' | 'code' | null>(null);
  const [exported, setExported] = useState<
    { format: ExportFormat; url: string } | { format: ExportFormat; pending: true }
  >();
  const [loadError, setLoadError] = useState<unknown>();

  const [formError, setFormError] = useState<string>();
  const [executedColumns, setExecutedColumns] = useState<Record<string, ColumnType>>({});
  const run = (next: Draft, opts: { url?: boolean } = {}) => {
    const empty = emptyRules(next.where) + next.joins.reduce((n, j) => n + emptyRules(j.where), 0);
    setFormError(
      empty
        ? `Fill in the value of ${empty} filter${empty > 1 ? 's' : ''}, or remove ${empty > 1 ? 'them' : 'it'}.`
        : undefined,
    );
    if (empty) return;
    const spec = buildSpec(next);
    setExecuted(spec);
    setExecutedColumns(columnTypesOf(next));
    setCursors([undefined]);
    setExported(undefined);
    if (opts.url !== false) void navigate({ search: { q: encodeSpec(spec) }, replace: true });
  };

  // Restore from a saved view or a linked spec once per URL.
  useEffect(() => {
    let cancelled = false;
    const apply = async (spec: QuerySpec) => {
      const next = await draftFromSpec(spec);
      if (cancelled) return;
      setLoadError(undefined);
      setDraft(next);
      run(next, { url: false });
    };
    if (search.view) {
      api('getView', { params: { id: search.view } })
        .then((view) => apply(view.query_spec))
        .catch((error: unknown) => !cancelled && setLoadError(error));
    } else if (search.q) {
      const parsed = QuerySpecSchema.safeParse(decodeSpec(search.q));
      if (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(executed))
        void apply(parsed.data).catch(setLoadError);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.view]);

  const cursor = cursors[cursors.length - 1];
  const result = useQuery({
    queryKey: ['query', executed, cursor],
    queryFn: () =>
      api('runQuery', { body: { ...executed!, page: { size: PAGE_SIZE, ...(cursor ? { cursor } : {}) } } }),
    enabled: !!executed,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    // A 4xx (invalid filter, no access) will not change on retry.
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });

  const exportMutation = useMutation({
    mutationFn: (format: ExportFormat) =>
      api('exportQuery', { body: { spec: executed!, format }, reason: `Data Explorer export (${format})` }),
    onMutate: (format) => setExported({ format, pending: true }),
    onSuccess: (res) => setExported({ format: res.format, url: res.url }),
    onError: () => setExported(undefined),
  });

  const primary = DATASET_CONTRACTS[draft.source.kind];
  const fields = useMemo(
    () => [
      ...fieldsOf(primary),
      ...draft.joins.flatMap((j) => fieldsOf(DATASET_CONTRACTS[j.kind], `${j.alias}.`)),
    ],
    [primary, draft.joins],
  );
  const allColumns = fields.map((f) => f.name);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const rerun = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    run(next);
  };

  return (
    <main style={{ padding: 24 }} className="stack">
      <h1 style={{ margin: 0 }}>Data Explorer</h1>
      <ErrorMessage error={loadError} />
      <DatasetPicker
        value={draft.source}
        onChange={(source) =>
          update(source.kind === draft.source.kind ? { source } : { ...initialDraft(), source })
        }
      />
      <div className="stack">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Joins</h2>
        {draft.joins.map((join, i) => (
          <JoinBuilder
            key={i}
            index={i}
            primary={primary}
            value={join}
            onChange={(j) => update({ joins: draft.joins.map((x, k) => (k === i ? j : x)) })}
            onRemove={() => update({ joins: draft.joins.filter((_, k) => k !== i) })}
          />
        ))}
        <div>
          <button
            type="button"
            onClick={() =>
              update({ joins: [...draft.joins, newJoin(primary, 'sample', draft.joins.length)] })
            }
          >
            Add join
          </button>
        </div>
      </div>
      <div className="stack">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Filters</h2>
        <FilterBuilder
          label="Filters"
          fields={fields}
          query={draft.where}
          onChange={(where) => update({ where })}
        />
      </div>
      {formError && (
        <p className="alert" role="alert" style={{ margin: 0 }}>
          {formError}
        </p>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={() => run({ ...draft, select: undefined })}>
          Run query
        </button>
        <button type="button" onClick={() => setDialog('save')} disabled={!executed}>
          Save view
        </button>
        <button type="button" onClick={() => setDialog('code')}>
          Copy as code
        </button>
      </div>
      <ResultsGrid
        result={executed ? result.data : undefined}
        error={result.error ?? exportMutation.error}
        loading={result.isFetching}
        page={cursors.length}
        sort={draft.sort}
        allColumns={allColumns}
        onSort={(sort: Sort | undefined) => rerun({ sort })}
        onNext={() => result.data?.nextCursor && setCursors((c) => [...c, result.data!.nextCursor!])}
        onPrevious={() => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c))}
        onColumns={(select) => rerun({ select })}
        onExport={(format) => exportMutation.mutate(format)}
        exported={exported}
      />
      {executed && <ChartPanel data={executed} columns={executedColumns} />}
      {dialog === 'save' && executed && (
        <SaveViewDialog
          spec={executed}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            void navigate({ search: { view: id } });
          }}
        />
      )}
      {dialog === 'code' && <CopyCodeDialog spec={buildSpec(draft)} onClose={() => setDialog(null)} />}
    </main>
  );
}
