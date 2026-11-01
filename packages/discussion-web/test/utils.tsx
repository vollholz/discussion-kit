/** Testhilfen: Provider (Query, Konfiguration) und ein fetch-Ersatz mit Antworten je Pfad. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { DiscussionProvider, type DiscussionConfig } from '../src/index.ts';

/** Angemeldete Person der Tests (Anna) mit Rechten auf Ebene der Organisation. */
export const ME = { id: '00000000-0000-4000-8000-000000000001', permissions: ['object:read', 'object:write'] };

export const TARGETS: DiscussionConfig['targets'] = {
  object: { basePath: '/v1/objects', here: 'zu diesem Objekt', restricted: 'Für dieses Objekt', files: 'Verträge, Fotos oder Lieferscheine' },
};

export function renderWith(ui: ReactElement, o: { me?: { permissions?: string[] }; config?: Partial<DiscussionConfig> } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const perms = o.me?.permissions ?? ME.permissions;
  const utils = render(
    <QueryClientProvider client={qc}>
      <DiscussionProvider targets={TARGETS} me={ME.id} can={p => perms.includes(p)} headers={() => ({ 'X-CSRF-Token': 'csrf-123' })} {...o.config}>{ui}</DiscussionProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

type Handler = (req: Request) => Response | Promise<Response>;
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers } });

/** fetch ersetzen: Schlüssel «METHOD /pfad» (ohne Query) → Antwort. Gibt die Aufrufe zurück. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req.clone());
    const url = new URL(req.url);
    const h = routes[`${req.method} ${url.pathname}`];
    if (!h) return json({ title: 'Nicht gefunden', status: 404 }, 404);
    return h(req);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}
