import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';

/**
 * SCIM provisioning (Phase 35, SCIM-04): the endpoint and a token for the identity provider. The token acts as
 * this admin, for SCIM only, and is shown once.
 */
export function ScimPanel() {
  const client = useQueryClient();
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api('listTokens') });
  const [shown, setShown] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api('createToken', { body: { name: 'SCIM provisioning', scopes: ['scim'], expires_in_days: 365 } }),
    onSuccess: async (t) => {
      setShown(t.token);
      await client.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api('revokeToken', { params: { id } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tokens'] }),
  });
  const scim = (tokens.data ?? []).filter((t) => t.scopes.includes('scim') && !t.revoked_at);
  const endpoint = `${window.location.origin}/api/scim/v2`;
  return (
    <section className="card stack" aria-label="SCIM provisioning">
      <h2 style={{ margin: 0 }}>SCIM provisioning</h2>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Let your identity provider (Okta, Entra ID…) create, update and deactivate users and groups. Group
        roles still come from the mappings above. Deactivated users lose access at once.
      </p>
      <p style={{ margin: 0 }}>
        SCIM endpoint (tenant URL): <code>{endpoint}</code>
      </p>
      <div className="row">
        <button type="button" className="primary" disabled={create.isPending} onClick={() => create.mutate()}>
          Create SCIM token
        </button>
      </div>
      {shown && (
        <p role="status" style={{ margin: 0, wordBreak: 'break-all' }}>
          Copy this token into your identity provider now; it is not shown again: <code>{shown}</code>
        </p>
      )}
      <ErrorMessage error={tokens.error ?? create.error ?? revoke.error} />
      {scim.length > 0 && (
        <table className="data" aria-label="SCIM tokens">
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Expires</th>
              <th scope="col">Last used</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {scim.map((t) => (
              <tr key={t.id}>
                <td>
                  <code>{t.token_prefix}…</code>
                </td>
                <td>{new Date(t.expires_at).toLocaleDateString()}</td>
                <td>{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never'}</td>
                <td>
                  <button type="button" className="danger" onClick={() => revoke.mutate(t.id)}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
