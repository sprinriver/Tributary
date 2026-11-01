export type StatusTone = 'ok' | 'warning' | 'error' | 'pending';

// Theme tokens from the app (Celeste design system, ADR 0014), with fallbacks for use outside it.
const toneColour: Record<StatusTone, [string, string]> = {
  ok: ['var(--success-text, #047857)', 'var(--success-bg, #ecfdf5)'],
  warning: ['var(--warn-text, #92400e)', 'var(--warn-bg, #fef3c7)'],
  error: ['var(--danger-text, #b91c1c)', 'var(--danger-bg, #fef2f2)'],
  pending: ['var(--pending-text, #475569)', 'var(--surface-2, #f3f5f9)'],
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: toneColour[tone][0],
        background: toneColour[tone][1],
        fontWeight: 600,
        fontSize: 11.5,
        lineHeight: 1.6,
        borderRadius: 999,
        padding: '1px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }}
      />
      {label}
    </span>
  );
}
