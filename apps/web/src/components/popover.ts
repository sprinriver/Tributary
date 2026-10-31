import { useEffect, useRef, useState } from 'react';

/** Open state for a header popover that closes on Escape or a click outside it. */
export function usePopover() {
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
  return { open, setOpen, ref };
}

export const POPOVER_STYLE = {
  position: 'absolute',
  right: 0,
  top: '100%',
  background: '#fff',
  border: '1px solid #d0d7de',
  padding: 8,
  minWidth: 220,
  zIndex: 10,
} as const;
