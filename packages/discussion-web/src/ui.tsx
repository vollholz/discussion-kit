/**
 * Eigene Grundbausteine (Vorgabe, ersetzbar über `components`): Symbole, Laden, Fehler, Leerzustand, Rückfrage,
 * Dialog, Hinweis «Recht fehlt». Klassen mit Präfix `dk-`, Farben über die Tokens der App (styles.css).
 */
import { useEffect, useId, useRef, type ComponentType, type ReactNode } from 'react';

/** Symbole (24er-Raster, Linien). */
const ICONS: Record<string, string> = {
  comment: '<path d="M4 5h16v11H9l-5 4z"/>',
  clip: '<path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7"/>',
  reply: '<path d="M10 9V5l-7 7 7 7v-4c5 0 8 1.5 11 5-1-6-4-10-11-11z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  doc: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  warn: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
};

export function Icon({ name }: { name: string }) {
  return <svg className="dk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }} />;
}

export interface DiscussionComponents {
  Loading: ComponentType<{ label: string; inline?: boolean }>;
  ErrorBox: ComponentType<{ error: unknown; onRetry?: () => void; compact?: boolean }>;
  Empty: ComponentType<{ icon: string; title: string; children?: ReactNode }>;
  Confirm: ComponentType<{ title: string; confirm: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void; children: ReactNode }>;
  Modal: ComponentType<{ title: string; onClose: () => void; footer?: ReactNode; width?: number; children: ReactNode }>;
  /** Hinweis, dass ein Recht fehlt; `lead` beginnt den Satz («Zum Hochladen»). */
  MissingRight: ComponentType<{ perm: string; lead: string }>;
}

/** Fehler einer Antwort der API (Problem Details). */
export class DiscussionApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly fields: { path: string; message: string }[];
  readonly requestId: string | null;
  constructor(status: number, problem: { title?: string; detail?: string; errors?: { path: string; message: string }[] }, requestId: string | null = null) {
    const title = problem.title ?? (status >= 500 ? 'Fehler auf dem Server' : `Fehler ${status}`);
    super(problem.detail ? `${title}: ${problem.detail}` : title);
    this.status = status; this.title = title; this.detail = problem.detail; this.fields = problem.errors ?? []; this.requestId = requestId;
  }
}

function Loading({ label, inline }: { label: string; inline?: boolean }) {
  return <div className={`dk-loading${inline ? ' inline' : ''}`} role="status"><span className="dk-spin" aria-hidden="true" />{label}</div>;
}

function ErrorBox({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = error instanceof DiscussionApiError ? error : null;
  const title = e?.title ?? 'Unerwarteter Fehler', detail = e ? e.detail : error instanceof Error ? error.message : String(error);
  return (
    <div className={`dk-error${compact ? ' compact' : ''}`} role="alert">
      <Icon name="warn" />
      <div className="dk-grow">
        <b>{title}</b>
        {detail ? <div>{detail}</div> : null}
        {e?.fields.length ? <ul>{e.fields.map((f, i) => <li key={i}>{f.message}</li>)}</ul> : null}
      </div>
      {onRetry && e?.status !== 404 ? <button type="button" className="dk-btn sm" onClick={onRetry}>Erneut versuchen</button> : null}
    </div>
  );
}

function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="dk-empty"><Icon name={icon} /><b>{title}</b>{children ? <div className="dk-muted">{children}</div> : null}</div>;
}

/** Dialog mit Fokus im Dialog, Esc schliesst, Fokus danach zurück an den Auslöser. */
function Dialog({ title, onClose, footer, width, children, role = 'dialog' }: { title: string; onClose: () => void; footer?: ReactNode; width?: number; children?: ReactNode; role?: 'dialog' | 'alertdialog' }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, a[href], textarea, input')?.focus();
    return () => prev?.focus?.();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], textarea, input') ?? [])];
    if (!items.length) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="dk-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="dk-dialog" role={role} aria-modal="true" aria-labelledby={id} style={width ? { width } : undefined} onKeyDown={onKey}>
        <h2 id={id}>{title}</h2>
        <div className="dk-dialog-body">{children}</div>
        {footer ? <div className="dk-dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

function Confirm({ title, confirm, danger, busy, onConfirm, onClose, children }: { title: string; confirm: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void; children?: ReactNode }) {
  return (
    <Dialog title={title} onClose={onClose} role="alertdialog"
      footer={<><button type="button" className="dk-btn" onClick={onClose} data-autofocus>Abbrechen</button><button type="button" className={`dk-btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={onConfirm}>{busy ? 'Bitte warten …' : confirm}</button></>}>
      {children}
    </Dialog>
  );
}

function Modal(p: { title: string; onClose: () => void; footer?: ReactNode; width?: number; children?: ReactNode }) {
  return <Dialog {...p} />;
}

/** Namen der Rechte des Baukastens (wie DISCUSSION_PERMISSIONS im Backend). */
const PERMISSION_LABEL: Record<string, string> = {
  'comment:write': 'Kommentieren', 'comment:moderate': 'Kommentare moderieren', 'attachment:write': 'Anhänge hochladen', 'attachment:delete': 'Anhänge löschen',
};

function MissingRight({ perm, lead }: { perm: string; lead: string }) {
  return <p className="dk-muted small dk-missing">{lead} fehlt dir das Recht «{PERMISSION_LABEL[perm] ?? perm}». Rechte vergibt die Administration deiner Organisation.</p>;
}

export const defaultComponents: DiscussionComponents = { Loading, ErrorBox, Empty, Confirm, Modal, MissingRight };

// ---------------------------------------------------------------- Formatierung (de-CH)

const dateTimeFmt = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const rtf = new Intl.RelativeTimeFormat('de-CH', { numeric: 'auto' });
const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

export function fmtDateTime(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '';
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? String(v) : dateTimeFmt.format(d);
}

/** «vor 5 Minuten», «gestern». */
export function relTime(v: string | number | Date | null | undefined, now = Date.now()): string {
  if (v == null || v === '') return '';
  const t = toDate(v).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.round((t - now) / 1000), a = Math.abs(s);
  if (a < 45) return 'gerade eben';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 30 * 86_400) return rtf.format(Math.round(s / 86_400), 'day');
  if (a < 365 * 86_400) return rtf.format(Math.round(s / (30 * 86_400)), 'month');
  return rtf.format(Math.round(s / (365 * 86_400)), 'year');
}

export function initials(name: string | null | undefined): string {
  const p = (name ?? '?').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '?') + (p.length > 1 ? p[p.length - 1]![0] : '')).toUpperCase();
}

/** Stabile Farbe je ID (Avatare); ausreichender Kontrast zu weisser Schrift. */
const AV = ['#0D6B5B', '#4B5BB8', '#A0550C', '#8A3B8F', '#2F62B5', '#7A4B2A', '#3F6B2A', '#B13A50'];
export function avatarColor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AV[Math.abs(h) % AV.length]!;
}

export function fmtBytes(n: number): string {
  const f = (v: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 }).format(v);
  if (n >= 1024 * 1024) return `${f(n / 1024 / 1024)} MB`;
  if (n >= 1024) return `${f(n / 1024)} KB`;
  return `${n} Bytes`;
}

// ---------------------------------------------------------------- Meldungen ohne Meldungen der App

/** Kurze Meldung unten am Rand (role=status), wenn die App keine eigenen Meldungen durchreicht. */
function flash(text: string, kind: 'ok' | 'error') {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('dk-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'dk-toasts'; host.className = 'dk-toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `dk-toast ${kind}`; el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

export const fallbackToaster = {
  show: (text: string) => flash(text, 'ok'),
  error: (e: unknown, title: string) => flash(`${title}: ${e instanceof Error ? e.message : String(e)}`, 'error'),
};
