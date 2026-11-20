import { useEffect, useMemo, useState } from 'react';
import { createRegistry } from '../registry';
import { demos } from '../walkthroughs';
import { Problems, Walkthrough } from './Walkthrough';

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; config: unknown }
  | { status: 'failed'; message: string };

/**
 * Shows the bundled demos, or the JSON config named by `?src=<url>`.
 * Config text is always rendered as text, never as markup.
 */
export function App() {
  const registry = useMemo(() => createRegistry(), []);
  const src = useMemo(() => new URLSearchParams(window.location.search).get('src'), []);
  const [loaded, setLoaded] = useState<Loaded>(() =>
    src === null ? { status: 'ready', config: demos } : { status: 'loading' },
  );

  useEffect(() => {
    if (src === null) return;
    let cancelled = false;
    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`the server answered ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then(
        (config) => {
          if (!cancelled) setLoaded({ status: 'ready', config });
        },
        (error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setLoaded({ status: 'failed', message });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (loaded.status === 'loading') {
    return (
      <main className="fw">
        <p>Loading the config…</p>
      </main>
    );
  }
  if (loaded.status === 'failed') {
    return (
      <Problems
        title="The config could not be loaded"
        problems={[{ severity: 'error', rule: 'load', path: ['src'], message: loaded.message }]}
      />
    );
  }
  return <Walkthrough config={loaded.config} registry={registry} />;
}
