import type { MeResponse } from '@tributary/contracts';
import { Link } from '@tanstack/react-router';
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
          <p style={{ margin: '0 0 8px' }}>
            <Link to="/settings/notifications" role="menuitem" onClick={() => setOpen(false)}>
              Email notifications
            </Link>
          </p>
          <button type="button" role="menuitem" onClick={() => void signOut(me)}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
