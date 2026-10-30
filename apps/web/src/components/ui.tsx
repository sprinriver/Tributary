import { StatusBadge, type StatusTone } from '@tributary/ui';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ApiError } from '../api.ts';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="hint">{hint}</span>}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, StatusTone> = { draft: 'pending', published: 'ok', archived: 'warning' };
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function VersionStatus({ status, live = true }: { status: string; live?: boolean }) {
  return <StatusBadge label={label(status)} tone={STATUS_TONE[status] ?? 'pending'} live={live} />;
}

/** Modal dialog on the native <dialog> element (focus trap and Escape come from the browser). Rendered only while
 * open, so a closed dialog never shares names with the page. */
export function Dialog({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <OpenDialog title={title} onClose={onClose}>
      {children}
    </OpenDialog>
  );
}

function OpenDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === value}
          aria-controls={`panel-${tab.id}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const body = error instanceof ApiError ? error.body : undefined;
  return (
    <div className="alert" role="alert">
      <p style={{ margin: 0 }}>
        {body?.message ?? (error instanceof Error ? error.message : 'Something went wrong.')}
      </p>
      {body?.errors && body.errors.length > 1 && (
        <ul>
          {body.errors.slice(0, 20).map((e, i) => (
            <li key={i}>
              {e.field ? <code>{e.field}</code> : null} {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const ASSAY_LABELS: Record<string, string> = {
  proteomics_dia: 'Proteomics (DIA)',
  proteomics_dda: 'Proteomics (DDA)',
  proteomics_tmt: 'Proteomics (TMT)',
  rnaseq: 'RNA-seq',
  crispr_screen: 'CRISPR screen',
  ngs_raw: 'NGS raw data',
};
