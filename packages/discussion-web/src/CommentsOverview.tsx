/**
 * Übersicht der angemeldeten Person über alle Ziele: eigene Kommentare und Erwähnungen, neueste zuerst, in zwei
 * Reitern (Pfeiltasten, Pos1 und Ende wechseln). Je Eintrag Ziel, Person, Zeit und Anfang des Textes; die eigene
 * Erwähnung ist hervorgehoben. Das Ziel öffnet die App (`onOpen`, wie bei der Glocke) mit der ID des Kommentars, damit
 * sie dorthin springen kann. Die API liefert nur Kommentare an Zielen, die die Person sieht.
 */
import { useId, useRef, useState } from 'react';
import { useCommentOverview, type OverviewComment, type OverviewView } from './api.ts';
import { useDiscussion } from './config.tsx';
import { CommentText } from './markdown.tsx';
import type { InboxTarget } from './NotificationBell.tsx';
import { avatarColor, fmtDateTime, initials, relTime } from './ui.tsx';

const VIEWS: OverviewView[] = ['mine', 'mentions'];
const LABEL: Record<OverviewView, string> = { mine: 'Meine Kommentare', mentions: 'Erwähnungen' };

export function CommentsOverview({ onOpen, defaultView = 'mine', onViewChange }: {
  onOpen: (t: InboxTarget, commentId: string) => void;
  defaultView?: OverviewView;
  /** Reiter gewechselt (z. B. für die Adresse der Seite). */
  onViewChange?: (v: OverviewView) => void;
}) {
  const [view, setView] = useState(defaultView);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const choose = (v: OverviewView) => { setView(v); onViewChange?.(v); };
  const onKey = (e: React.KeyboardEvent) => {
    const i = VIEWS.indexOf(view), n = VIEWS.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(VIEWS[next]!);
    tabs.current[next]?.focus();
  };
  return (
    <div className="co">
      <div role="tablist" aria-label="Kommentare und Erwähnungen" className="co-tabs" onKeyDown={onKey}>
        {VIEWS.map((v, i) => (
          <button key={v} ref={el => { tabs.current[i] = el; }} type="button" role="tab" id={`${id}-${v}`} className="co-tab"
            aria-selected={view === v} aria-controls={`${id}-panel`} tabIndex={view === v ? 0 : -1} onClick={() => choose(v)}>
            {LABEL[v]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`} className="co-panel">
        <OverviewList key={view} view={view} onOpen={onOpen} />
      </div>
    </div>
  );
}

function OverviewList({ view, onOpen }: { view: OverviewView; onOpen: (t: InboxTarget, commentId: string) => void }) {
  const d = useDiscussion();
  const { Loading, ErrorBox, Empty } = d.ui;
  const q = useCommentOverview(view);
  if (q.isPending) return <Loading label={view === 'mine' ? 'Deine Kommentare werden geladen …' : 'Erwähnungen werden geladen …'} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.pages.flatMap(p => p.items);
  return (
    <>
      {items.length ? (
        <ol className="co-list" aria-label={LABEL[view]}>
          {items.map(c => <li key={c.id}><OverviewItem c={c} view={view} me={d.me} onOpen={onOpen} /></li>)}
        </ol>
      ) : q.hasNextPage ? null
        : view === 'mine' ? <Empty icon="comment" title="Noch keine Kommentare">Kommentare und Antworten, die du schreibst, erscheinen hier – neueste zuerst.</Empty>
        : <Empty icon="at" title="Keine Erwähnungen">Wenn dich jemand in einem Kommentar mit @ erwähnt, erscheint es hier.</Empty>}
      {q.hasNextPage ? <button type="button" className="dk-btn sm co-more" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Lädt …' : 'Ältere laden'}</button> : null}
    </>
  );
}

function OverviewItem({ c, view, me, onOpen }: { c: OverviewComment; view: OverviewView; me: string | null; onOpen: (t: InboxTarget, commentId: string) => void }) {
  const what = view === 'mentions' ? `${c.author.name} hat dich erwähnt` : c.replyTo ? 'Du hast geantwortet' : 'Du hast kommentiert';
  return (
    <article className="cm co-item" aria-label={`${what}: ${c.targetTitle}`}>
      <span className="dk-avatar" style={{ background: avatarColor(c.author.id) }} aria-hidden="true">{initials(c.author.name)}</span>
      <div className="cm-main">
        <div className="cm-head">
          <span>{view === 'mentions' ? <><b>{c.author.name}</b> hat dich erwähnt</> : what} ·</span>
          <button type="button" className="dk-link co-target" onClick={() => onOpen({ type: c.targetType, id: c.targetId }, c.id)}>{c.targetTitle}</button>
          <time className="dk-muted dk-small" dateTime={String(c.createdAt)} title={fmtDateTime(c.createdAt)}>{relTime(c.createdAt)}</time>
          {c.editedAt ? <span className="dk-muted dk-small" title={`Bearbeitet ${fmtDateTime(c.editedAt)}`}>bearbeitet</span> : null}
        </div>
        <div className="co-text"><CommentText text={c.body ?? ''} mentions={c.mentions} me={me} /></div>
        {c.replyCount ? <div className="dk-muted dk-small">{c.replyCount === 1 ? '1 Antwort' : `${c.replyCount} Antworten`}</div> : null}
      </div>
    </article>
  );
}
