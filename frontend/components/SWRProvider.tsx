'use client';
import { SWRConfig } from 'swr';

/** Global SWR config (issue #10).
 *
 * SWR's default `onErrorRetry` retries 10 times with exponential
 * backoff — fine for transient network blips, terrible when an
 * endpoint is reliably 500'ing (e.g. a schema-validation bug),
 * because every retry holds a DB connection and saturates the
 * backend's pool within seconds.
 *
 * Cap retries at 3, jitter the delay, and stop on 4xx since those
 * never resolve themselves. */
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        onErrorRetry: (err, _key, _cfg, revalidate, { retryCount }) => {
          const status = (err as { status?: number; message?: string } | undefined);
          // 4xx — client bug or auth. Retrying won't help.
          const code = typeof status?.status === 'number'
            ? status.status
            : Number((status?.message || '').match(/^(\d{3}):/)?.[1] || 0);
          if (code >= 400 && code < 500) return;
          if (retryCount >= 3) return;
          // Jittered exponential backoff: 500ms → 1.5s → 4.5s plus
          // up to 250ms of random spread so 100 tabs don't all retry
          // simultaneously.
          const base = 500 * Math.pow(3, retryCount);
          const jitter = Math.floor(Math.random() * 250);
          setTimeout(() => revalidate({ retryCount }), base + jitter);
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
