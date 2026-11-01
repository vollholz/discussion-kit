/**
 * Konfiguration der Oberfläche (`DiscussionProvider`): Was das Paket von der App braucht – Pfade je Zieltyp, Header der
 * Anfragen (CSRF, Organisation), die eigene Principal-ID, Rechte auf Ebene der Organisation. Alles andere hat
 * Vorgaben (Personensuche über `GET /v1/people`, eigene Meldungen und Grundbausteine) und lässt sich ersetzen, damit
 * die Komponenten wie der Rest der App aussehen.
 */
import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { defaultComponents, DiscussionApiError, fallbackToaster, type DiscussionComponents } from './ui.tsx';

/** Wörter und Pfad je Zieltyp. */
export interface TargetConfig {
  /** Pfad der Listen, z. B. `/v1/objects` (wie `basePath` im Backend). */
  basePath: string;
  /** «zu diesem Objekt» (Leerzustände). */
  here: string;
  /** «Für dieses Objekt» (Hinweis bei eingeschränktem Zugriff). */
  restricted: string;
  /** Beispiele im Leerzustand der Anhänge, z. B. «Verträge, Fotos oder Lieferscheine». */
  files?: string;
}

export interface Person { id: string; name: string; email?: string | null }

export interface Toaster { show(text: string): void; error(e: unknown, title: string): void }

export interface DiscussionConfig {
  /** Zieltypen der App (Schlüssel = `targetType`). */
  targets: Record<string, TargetConfig>;
  /** Basis der API (Standard: gleiche Herkunft). */
  baseUrl?: string;
  /** Zusätzliche Header je Anfrage, z. B. `X-CSRF-Token`, `X-Tenant`. */
  headers?: () => Record<string, string>;
  /** Links ohne eigene Header (Download, Vorschaubild) ergänzen, z. B. um die Organisation (Standard: unverändert). */
  link?: (url: string) => string;
  /** Antwort 401: Sitzung abgelaufen. */
  onUnauthorized?: () => void;
  /** Eigene Principal-ID (eigene Kommentare bearbeiten, eigene Anhänge löschen); null, solange unbekannt. */
  me: string | null;
  /** Recht auf Ebene der Organisation (gilt, wenn das Ziel kein `can` liefert). */
  can: (perm: string) => boolean;
  /** Personensuche für @-Erwähnungen (Standard: `GET /v1/people?q=…&limit=…`). */
  searchPeople?: (q: string, limit: number) => Promise<Person[]>;
  /** Meldungen der App (Standard: eigene Meldungsleiste der Komponenten). */
  toast?: Toaster;
  /** Grundbausteine der App statt der eigenen (Fehler, Laden, Leer, Dialoge, Hinweis «Recht fehlt»). */
  components?: Partial<DiscussionComponents>;
  /** Fehler aus einer Antwort bauen, wie die Fehlerbausteine der App ihn erwarten (Standard: `DiscussionApiError`). */
  toError?: (status: number, problem: ProblemBody, requestId: string | null) => Error;
}

/** Fehler als Problem Details (RFC 9457). */
export interface ProblemBody { title?: string; detail?: string; status?: number; errors?: { path: string; message: string }[]; [k: string]: unknown }

export interface Discussion extends Required<Omit<DiscussionConfig, 'toast' | 'onUnauthorized' | 'components'>> {
  toast: Toaster | null;
  onUnauthorized?: () => void;
  /** Basis für Links im Dokument (Download, Bild): relativ, wenn die App keine `baseUrl` setzt. */
  linkBase: string;
  ui: DiscussionComponents;
}

const Ctx = createContext<Discussion | null>(null);

export function DiscussionProvider({ children, ...config }: DiscussionConfig & { children: ReactNode }) {
  const value = useMemo<Discussion>(() => {
    const baseUrl = config.baseUrl ?? defaultOrigin(), headers = config.headers ?? (() => ({}));
    return {
      targets: config.targets, baseUrl, linkBase: config.baseUrl ?? '', headers, link: config.link ?? (u => u), me: config.me, can: config.can, onUnauthorized: config.onUnauthorized,
      searchPeople: config.searchPeople ?? defaultPeopleSearch(baseUrl, headers),
      toast: config.toast ?? null,
      ui: { ...defaultComponents, ...config.components },
      toError: config.toError ?? ((status, problem, requestId) => new DiscussionApiError(status, problem, requestId)),
    };
  }, [config.targets, config.baseUrl, config.headers, config.link, config.me, config.can, config.onUnauthorized, config.searchPeople, config.toast, config.components, config.toError]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDiscussion(): Discussion {
  const v = useContext(Ctx);
  if (!v) throw new Error('DiscussionProvider fehlt: Komponenten von @vollholz/discussion-web brauchen ihn (README).');
  return v;
}

/** Gleiche Herkunft als absolute Adresse (fetch ausserhalb des Browsers, z. B. in Tests, kennt keine relativen Pfade). */
const defaultOrigin = () => (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' ? window.location.origin : '');

/** Personenverzeichnis nach Konvention von `@vollholz/iam` (`GET /v1/people`). */
function defaultPeopleSearch(baseUrl: string, headers: () => Record<string, string>) {
  return async (q: string, limit: number): Promise<Person[]> => {
    const r = await fetch(`${baseUrl}/v1/people?${new URLSearchParams({ q, limit: String(limit) })}`, { credentials: 'same-origin', headers: { Accept: 'application/json', ...headers() } });
    if (!r.ok) throw new Error(`Personensuche: HTTP ${r.status}`);
    const b = await r.json() as { items: { id: string; name?: string | null; displayName?: string | null; email?: string | null; kind?: string }[] };
    return b.items.filter(p => !p.kind || p.kind === 'user').map(p => ({ id: p.id, name: p.name ?? p.displayName ?? p.email ?? 'Unbekannt', email: p.email ?? null }));
  };
}

export type { ComponentType };

/** Meldungen der App oder die eigene Meldungsleiste. */
export function useToaster(): Toaster {
  const d = useDiscussion();
  return d.toast ?? fallbackToaster;
}
