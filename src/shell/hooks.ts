import { useCallback, useEffect, useState } from 'react';
import {
  decodeHash,
  encodeHash,
  isView,
  shapeOf,
  type Cursor,
  type ResolvedWalkthrough,
  type View,
} from '../core';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'feature-walkthrough:theme';

function storedTheme(): Theme | undefined {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The system theme unless the reader picked one. The choice is kept per browser. */
export function useTheme(): { theme: Theme; toggle(): void } {
  const [system, setSystem] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [chosen, setChosen] = useState<Theme | undefined>(storedTheme);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme = chosen ?? system;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setChosen(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
  }, [theme]);

  return { theme, toggle };
}

const VIEW_KEY = 'feature-walkthrough:view';

function storedView(): View | undefined {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    return isView(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The view to show. In order of preference: the one the address names, the reader's own earlier
 * choice (kept per browser, like the theme), the author's default, and the grid.
 */
export function useView(
  fromAddress: View | undefined,
  authorDefault: View | undefined,
): { view: View; choose(next: View): void } {
  const [chosen, setChosen] = useState<View | undefined>(storedView);
  const choose = useCallback((next: View) => {
    setChosen(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
  }, []);
  return { view: fromAddress ?? chosen ?? authorDefault ?? 'grid', choose };
}

/** The cursor, kept in step with the URL hash in both directions. */
export function useCursor(
  walkthroughs: readonly ResolvedWalkthrough[],
): [Cursor, (next: Cursor) => void] {
  const read = useCallback((): Cursor => {
    const index = walkthroughs.map((item) => ({ id: item.id, shape: shapeOf(item) }));
    return decodeHash(window.location.hash, index) ?? { w: '', s: 0, c: 0 };
  }, [walkthroughs]);
  const [cursor, setCursor] = useState<Cursor>(read);

  useEffect(() => {
    const onHashChange = () => setCursor(read());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [read]);

  useEffect(() => {
    const hash = encodeHash(cursor);
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }, [cursor]);

  return [cursor, setCursor];
}
