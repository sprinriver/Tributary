import type { MeResponse } from '@tributary/contracts';
import { signOut } from '../auth.ts';
import { POPOVER_STYLE, usePopover } from './popover.ts';

export function UserMenu({ me }: { me: MeResponse }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {me.user.name}
      </button>
      {open && (
        <div role="menu" style={POPOVER_STYLE}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>{me.user.email}</p>
          <button type="button" role="menuitem" onClick={() => void signOut(me)}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
