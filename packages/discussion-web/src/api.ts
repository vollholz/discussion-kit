/**
 * Zugriff auf die API des Baukastens (`@vollholz/discussion`): Kommentare und Anhänge eines Ziels, Benachrichtigungen.
 * Gleiche Herkunft mit Sitzungs-Cookie, Header aus der Konfiguration (CSRF, Organisation), Fehler über `toError`.
 * Hochladen über XMLHttpRequest (fetch meldet keinen Upload-Fortschritt).
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDiscussion, type Discussion, type ProblemBody } from './config.tsx';

/** Ziel von Kommentaren und Anhängen (wie `targetType`/`targetId` der API). */
export interface Target { type: string; id: string }
export interface PersonRef { id: string; name: string }

export interface Comment {
  id: string; targetType: string; targetId: string; objectId?: string;
  author: PersonRef; body: string | null; mentions: PersonRef[]; replyTo: string | null;
  createdAt: string; editedAt: string | null; revision: number; deleted: boolean;
}
export interface Attachment {
  id: string; targetType: string; targetId: string; objectId?: string;
  name: string; size: number; mediaType: string; sha256: string; uploadedBy: PersonRef | null; uploadedAt: string; preview: boolean;
}
export interface Revision { revision: number; body: string; mentions: PersonRef[]; writtenAt: string; replacedAt: string }
export interface Notification {
  id: string; kind: 'mention' | 'reply'; createdAt: string; readAt: string | null; actor: PersonRef | null;
  target: { type: string; id: string; title: string | null; available: boolean };
  subject: { type: 'comment'; id: string; excerpt: string | null };
}
interface Page<T> { items: T[]; nextCursor: string | null; total: number }

/** Schlüssel der Abfragen (React Query). */
export const dkKeys = {
  all: ['discussion'] as const,
  comments: (t: Target) => ['discussion', 'comments', t.type, t.id] as const,
  attachments: (t: Target) => ['discussion', 'attachments', t.type, t.id] as const,
  revisions: (id: string) => ['discussion', 'revisions', id] as const,
  inbox: ['discussion', 'inbox'] as const,
};

/** Anfrage an die API; JSON-Antwort oder Fehler nach `toError`. */
export async function request<T>(d: Discussion, method: string, path: string, o: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${d.baseUrl}${path}`, {
      method, credentials: 'same-origin', signal: o.signal,
      headers: { Accept: 'application/json, application/problem+json', ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...d.headers(), ...o.headers },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw d.toError(0, { title: 'Keine Verbindung', detail: 'Der Server ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut.' }, null);
  }
  if (r.status === 401) d.onUnauthorized?.();
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!r.ok) throw d.toError(r.status, (body ?? {}) as ProblemBody, r.headers.get('x-request-id'));
  return body as T;
}

const listPath = (d: Discussion, t: Target, what: 'comments' | 'attachments') => {
  const base = d.targets[t.type]?.basePath;
  if (!base) throw new Error(`Zieltyp «${t.type}» fehlt in der Konfiguration (DiscussionProvider targets)`);
  return `${base}/${encodeURIComponent(t.id)}/${what}`;
};

export function useComments(t: Target) {
  const d = useDiscussion();
  return useInfiniteQuery({
    queryKey: dkKeys.comments(t), initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => request<Page<Comment>>(d, 'GET', `${listPath(d, t, 'comments')}?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }),
    getNextPageParam: l => l.nextCursor ?? null,
  });
}

export function useAttachments(t: Target) {
  const d = useDiscussion();
  return useInfiniteQuery({
    queryKey: dkKeys.attachments(t), initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => request<Page<Attachment>>(d, 'GET', `${listPath(d, t, 'attachments')}?limit=100${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }),
    getNextPageParam: l => l.nextCursor ?? null,
  });
}

/** Anzahl der Kommentare bzw. Anhänge eines Ziels (für Reiter und Zähler); `undefined`, solange unbekannt. */
export function useDiscussionCounts(t: Target): { comments?: number; attachments?: number } {
  return { comments: useComments(t).data?.pages[0]?.total, attachments: useAttachments(t).data?.pages[0]?.total };
}

export function useCommentMutations(t: Target) {
  const d = useDiscussion();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: dkKeys.comments(t) });
  return {
    create: useMutation({
      mutationFn: (b: { body: string; replyTo?: string }) => request<Comment>(d, 'POST', listPath(d, t, 'comments'), { body: b }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (b: { id: string; body: string; revision: number }) => request<Comment>(d, 'PATCH', `/v1/comments/${encodeURIComponent(b.id)}`, { body: { body: b.body }, headers: { 'If-Match': `W/"${b.revision}"` } }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => request<void>(d, 'DELETE', `/v1/comments/${encodeURIComponent(id)}`),
      onSuccess: refresh,
    }),
  };
}

export function useDeleteAttachment(t: Target) {
  const d = useDiscussion();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(d, 'DELETE', `/v1/attachments/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: dkKeys.attachments(t) }),
  });
}

/** Adresse des Inhalts (Download, Vorschau), über `link` der App (z. B. Organisation als Parameter). */
export const contentUrl = (d: Discussion, id: string) => d.link(`${d.linkBase}/v1/attachments/${encodeURIComponent(id)}/content`);

/** Datei hochladen; `onProgress` mit Anteil 0…1. Abbrechen über `signal`. */
export function uploadAttachment(d: Discussion, t: Target, file: File, o: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${d.baseUrl}${listPath(d, t, 'attachments')}?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json, application/problem+json');
    for (const [k, v] of Object.entries(d.headers())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => { if (e.lengthComputable && e.total) o.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300) { o.onProgress?.(1); resolve(body as Attachment); return; }
      if (xhr.status === 401) d.onUnauthorized?.();
      reject(d.toError(xhr.status, (body ?? {}) as ProblemBody, xhr.getResponseHeader('x-request-id')));
    };
    xhr.onerror = () => reject(d.toError(0, { title: 'Upload fehlgeschlagen', detail: 'Der Server ist nicht erreichbar.' }, null));
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen', 'AbortError'));
    if (o.signal) {
      if (o.signal.aborted) { xhr.abort(); return; }
      o.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

export function useNotifications() {
  const d = useDiscussion();
  return useInfiniteQuery({
    queryKey: dkKeys.inbox, initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => request<{ items: Notification[]; nextCursor: string | null; unread: number }>(d, 'GET', `/v1/me/notifications?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }),
    getNextPageParam: l => l.nextCursor ?? null,
    refetchInterval: 60_000, refetchOnWindowFocus: true,
  });
}

export function useMarkRead() {
  const d = useDiscussion();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { ids: string[] } | { all: true }) => request<{ updated: number }>(d, 'POST', '/v1/me/notifications/read', { body: b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dkKeys.inbox }),
  });
}

/** Erwähnung im Kommentartext, wie der Server sie erwartet. Klammern im Namen werden ersetzt. */
export const mentionToken = (p: { id: string; name: string }) => `@[${p.name.replace(/[[\]\n]/g, ' ').trim()}](${p.id})`;
