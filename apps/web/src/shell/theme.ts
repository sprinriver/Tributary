import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'tributary.theme';

/** Saved choice, else the operating system's preference. */
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Private windows: fall through to the system preference.
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) ?? 'light',
  );
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Not persisted in private windows.
      }
      return next;
    });
  }, []);
  return { theme, toggle };
}

/** Collapsed sidebar, remembered per browser. */
export function useCollapsed(): [boolean, () => void] {
  const key = 'tributary.sidebar.collapsed';
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(key, c ? '0' : '1');
      } catch {
        // ignore
      }
      return !c;
    });
  }, []);
  return [collapsed, toggle];
}
