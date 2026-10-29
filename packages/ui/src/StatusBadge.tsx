export type StatusTone = 'ok' | 'warning' | 'error' | 'pending';

const toneColour: Record<StatusTone, string> = {
  ok: '#1a7f37',
  warning: '#9a6700',
  error: '#cf222e',
  pending: '#57606a',
};

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  /** A live status region (default). Use false inside tables and lists, where the text is part of the row. */
  live?: boolean;
}

/** Small text badge; the tone is conveyed by text as well as colour. */
export function StatusBadge({ label, tone, live = true }: StatusBadgeProps) {
  return (
    <span
      role={live ? 'status' : undefined}
      data-tone={tone}
      style={{
        color: toneColour[tone],
        fontWeight: 600,
        border: '1px solid currentColor',
        borderRadius: 4,
        padding: '0 6px',
      }}
    >
      {label}
    </span>
  );
}
