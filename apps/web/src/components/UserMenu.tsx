import type { MeResponse } from '@tributary/contracts';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '../auth.ts';

export function UserMenu({ me }: { me: MeResponse }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {me.user.name}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            background: '#fff',
            border: '1px solid #d0d7de',
            padding: 8,
            minWidth: 220,
            zIndex: 10,
          }}
        >
          <p style={{ margin: '0 0 8px', color: '#57606a' }}>{me.user.email}</p>
          <button type="button" role="menuitem" onClick={() => void signOut(me)}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
