import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage, Field } from '../components/ui.tsx';

/** AI settings (SPEC §11.1): the provider is set in the deployment; admins switch features and set the budget. */
export function AiSettingsCard() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => api('getAiSettings') });
  const [draft, setDraft] = useState<{
    assistant_enabled: boolean;
    write_tools_enabled: boolean;
    monthly_token_budget: number;
  } | null>(null);
  const s = settings.data;
  const form =
    draft ??
    (s && {
      assistant_enabled: s.assistant_enabled,
      write_tools_enabled: s.write_tools_enabled,
      monthly_token_budget: s.monthly_token_budget,
    });
  const save = useMutation({
    mutationFn: () => api('putAiSettings', { body: form!, reason: 'AI settings' }),
    onSuccess: async () => {
      setDraft(null);
      await client.invalidateQueries({ queryKey: ['ai-settings'] });
      await client.invalidateQueries({ queryKey: ['system-health'] });
    },
  });
  return (
    <section className="card stack" aria-label="AI assistant">
      <h2 style={{ margin: 0 }}>AI assistant</h2>
      <ErrorMessage error={settings.error} />
      {s && form && (
        <>
          <p style={{ margin: 0 }}>
            Provider:{' '}
            <strong>
              {s.provider === 'none' ? 'none (assistant unavailable)' : `${s.provider} · ${s.model}`}
            </strong>
            . The provider is chosen in the deployment (AI_PROVIDER). Used this month:{' '}
            {s.tokens_used_this_month.toLocaleString()} of {s.monthly_token_budget.toLocaleString()} tokens.
          </p>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.assistant_enabled}
              onChange={(e) => setDraft({ ...form, assistant_enabled: e.target.checked })}
            />
            Assistant on
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.write_tools_enabled}
              onChange={(e) => setDraft({ ...form, write_tools_enabled: e.target.checked })}
            />
            Allow write tools (each write still needs the user's approval)
          </label>
          <Field label="Monthly token budget">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                value={form.monthly_token_budget}
                onChange={(e) =>
                  setDraft({
                    ...form,
                    monthly_token_budget: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                  })
                }
              />
            )}
          </Field>
          <div className="row" style={{ alignItems: 'center' }}>
            <button type="button" className="primary" onClick={() => save.mutate()} disabled={save.isPending}>
              Save AI settings
            </button>
            {save.isSuccess && draft === null && <span role="status">Saved</span>}
          </div>
          <ErrorMessage error={save.error} />
          <details>
            <summary>Tools ({s.tools.length})</summary>
            <ul>
              {s.tools.map((t) => (
                <li key={t.name}>
                  <code>{t.name}</code> ({t.risk}) — {t.description}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
