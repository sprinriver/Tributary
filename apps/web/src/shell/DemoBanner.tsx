import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { isEmbedded } from './embedded.ts';

/** Public demo instances say so on every page, with the published demo logins (GET /v1/instance). */
export function DemoBanner() {
  const instance = useQuery({
    queryKey: ['instance'],
    queryFn: () => api('getInstance'),
    staleTime: Infinity,
  });
  const info = instance.data;
  if (!info?.demo) return null;
  return (
    <div className="demo-banner" role="note" aria-label="Demo instance">
      {isEmbedded() && (
        <>
          <a href={window.location.href} target="_blank" rel="noopener noreferrer">
            <strong>Open Tributary in a new tab</strong>
          </a>{' '}
          to sign in (signing in does not work inside an embedded frame).{' '}
        </>
      )}
      <strong>Public demo</strong> — synthetic data only, never upload real data.
      {info.notice && <> {info.notice}</>}
      {info.demo_logins.length > 0 && (
        <>
          {' '}
          Sign in as{' '}
          {info.demo_logins.map((l, i) => (
            <span key={l.username}>
              {i > 0 && ' or '}
              <code>{l.username}</code> / <code>{l.password}</code>
            </span>
          ))}
          .
        </>
      )}
    </div>
  );
}
