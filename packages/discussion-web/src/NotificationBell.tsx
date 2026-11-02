/**
 * Glocke in der Kopfzeile: Zahl der ungelesenen Benachrichtigungen, Liste im aufklappbaren Bereich (Disclosure, kein
 * Menü: Einträge mit Text und eigene Schaltflächen). Ein Eintrag öffnet sein Ziel (wohin, entscheidet die Shell über
 * `onOpen`, mit der ID des Kommentars für `CommentsPanel commentId`) und gilt dann als gelesen. Einträge an Zielen, die die Person nicht (mehr) sieht, erscheinen nicht – es gäbe
 * nichts zu öffnen und nichts zu erfahren; ungelesene davon gelten als gelesen, damit die Zahl an der Glocke stimmt.
 * Esc und Klick ausserhalb schliessen, der Fokus geht zurück an die Glocke. Mit `onShowAll` führt ein Link unten zur
 * Übersicht der eigenen Kommentare und Erwähnungen (`CommentsOverview`, wohin entscheidet die Shell).
 *
 * Weitere Arten anderer Bausteine (z. B. `task_assigned`) stellt die App über `notificationKinds` im Provider dar;
 * unbekannte Arten erscheinen mit einem allgemeinen Text. `onOpen` bekommt als dritten Wert den ganzen Eintrag, damit
 * die Shell nach Art des Gegenstands (`subject.type`) entscheiden kann.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMarkRead, useNotifications, type Notification } from './api.ts';
import { useDiscussion, type NotificationKind } from './config.tsx';
import { avatarColor, fmtDateTime, Icon, initials, relTime } from './ui.tsx';

export interface InboxTarget { type: string; id: string }

const WHAT: Record<string, string> = { mention: 'hat dich erwähnt', reply: 'hat auf deinen Kommentar geantwortet' };

/** Zeile eines Eintrags: Art der App, eingebaute Art (Kommentare) oder allgemeiner Text. */
function line(n: Notification, kinds: Record<string, NotificationKind>): ReactNode {
  const own = Object.hasOwn(kinds, n.kind) ? kinds[n.kind] : undefined;
  if (own) return own.text(n);
  const what = Object.hasOwn(WHAT, n.kind) ? WHAT[n.kind] : undefined;
  if (what) return <><b>{n.actor?.name ?? 'Jemand'}</b> {what}</>;
  return n.actor ? <>Neue Benachrichtigung von <b>{n.actor.name}</b></> : 'Neue Benachrichtigung';
}

export function NotificationBell({ onOpen, onShowAll }: {
  /** Eintrag öffnen: Ziel, ID des Gegenstands (bei Kommentaren die ID des Kommentars) und der ganze Eintrag. */
  onOpen: (t: InboxTarget, subjectId: string, n: Notification) => void;
  onShowAll?: () => void;
}) {
  const { ui: { Loading, ErrorBox }, notificationKinds } = useDiscussion();
  const q = useNotifications();
  const mark = useMarkRead();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const unread = q.data?.pages[0]?.unread ?? 0;
  const all = q.data?.pages.flatMap(p => p.items) ?? [];
  const items = all.filter(n => n.target.available);
  // Ziel nicht (mehr) sichtbar: als gelesen markieren (einmal je Stand; scheitert es, kein erneuter Versuch in Schleife)
  const gone = all.filter(n => !n.target.available && !n.readAt).map(n => n.id).join(',');
  const { mutate } = mark;
  useEffect(() => { if (gone) mutate({ ids: gone.split(',') }); }, [gone, mutate]);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('.nb-item, .nb-all')?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    // Esc nur, wenn der Fokus in der Glocke oder ihrem Bereich liegt (sonst gehört Esc z. B. der Schublade)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !(pop.current?.contains(document.activeElement) || btn.current === document.activeElement)) return;
      e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const pick = (n: Notification) => {
    if (!n.readAt) mark.mutate({ ids: [n.id] });
    setOpen(false);
    onOpen({ type: n.target.type, id: n.target.id }, n.subject.id, n);
  };

  return (
    <div className="nb">
      <button ref={btn} type="button" className="dk-iconbtn nb-btn" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={unread ? `Benachrichtigungen, ${unread} ungelesen` : 'Benachrichtigungen'} title="Benachrichtigungen"
        onClick={() => setOpen(o => !o)}>
        <Icon name="bell" />
        {unread ? <span className="nb-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div ref={pop} id={id} className="nb-pop" role="dialog" aria-label="Benachrichtigungen">
          <div className="nb-head">
            <b>Benachrichtigungen</b>
            <span className="dk-spacer" />
            {unread ? <button type="button" className="dk-link dk-small nb-all" disabled={mark.isPending} onClick={() => mark.mutate({ all: true })}>Alle als gelesen markieren</button> : null}
          </div>
          {q.isPending ? <Loading inline label="Benachrichtigungen werden geladen …" />
            : q.error ? <ErrorBox error={q.error} compact onRetry={() => void q.refetch()} />
            : !items.length ? <p className="nb-empty dk-muted dk-small">Keine Benachrichtigungen. Wenn dich jemand in einem Kommentar erwähnt oder dir antwortet, erscheint es hier.</p>
            : (
              <ul className="nb-list">
                {items.map(n => {
                  const icon = Object.hasOwn(notificationKinds, n.kind) ? notificationKinds[n.kind]?.icon : undefined;
                  return (
                  <li key={n.id}>
                    <button type="button" className={`nb-item${n.readAt ? '' : ' unread'}`} onClick={() => pick(n)}>
                      {n.actor && !icon ? <span className="dk-avatar" style={{ background: avatarColor(n.actor.id) }} aria-hidden="true">{initials(n.actor.name)}</span> : <span className="dk-avatar nb-none" aria-hidden="true">{icon ?? <Icon name="bell" />}</span>}
                      <span className="nb-text">
                        <span>{line(n, notificationKinds)} · <span className="nb-target">{n.target.title}</span></span>
                        {n.subject.excerpt ? <span className="nb-excerpt dk-muted">{n.subject.excerpt}</span> : null}
                        <time className="dk-muted dk-small" dateTime={String(n.createdAt)} title={fmtDateTime(n.createdAt)}>{relTime(n.createdAt)}{n.readAt ? '' : <span className="dk-sr"> · ungelesen</span>}</time>
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
          {q.hasNextPage ? <button type="button" className="dk-btn sm ghost nb-more" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Lädt …' : 'Ältere laden'}</button> : null}
          {onShowAll ? <div className="nb-foot"><button type="button" className="dk-link dk-small" onClick={() => { setOpen(false); onShowAll(); }}>Alle Kommentare und Erwähnungen</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}
