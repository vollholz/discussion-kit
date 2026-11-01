/**
 * Übersicht der angemeldeten Person über alle Ziele: eigene Kommentare und Erwähnungen in einer Liste, neueste zuerst;
 * Filterknöpfe grenzen auf eines von beiden ein. Je Eintrag Ziel, wie die Person beteiligt ist, Zeit und Anfang des
 * Textes; die eigene Erwähnung ist hervorgehoben. Ein Eintrag öffnet sein Ziel in der App (`onOpen`, wie bei der
 * Glocke) mit der ID des Kommentars, damit sie dorthin springen kann: mit der Maus der ganze Eintrag (ausser Links im
 * Text und beim Markieren), mit der Tastatur der Knopf mit dem Ziel – kein Knopf um den Text, der selbst Links
 * enthalten kann. Die API liefert nur Kommentare an Zielen, die die Person sieht.
 */
import { useState } from 'react';
import { useCommentOverview, type OverviewComment, type OverviewFilter } from './api.ts';
import { useDiscussion } from './config.tsx';
import { CommentText } from './markdown.tsx';
import type { InboxTarget } from './NotificationBell.tsx';
import { avatarColor, fmtDateTime, Icon, initials, relTime } from './ui.tsx';

const FILTERS: OverviewFilter[] = ['all', 'mentions', 'mine'];
const LABEL: Record<OverviewFilter, string> = { all: 'Alle', mentions: 'Erwähnungen', mine: 'Meine Kommentare' };
const LIST: Record<OverviewFilter, string> = { all: 'Kommentare und Erwähnungen', mentions: 'Erwähnungen', mine: 'Meine Kommentare' };

export function CommentsOverview({ onOpen, defaultFilter = 'all', onFilterChange }: {
  onOpen: (t: InboxTarget, commentId: string) => void;
  defaultFilter?: OverviewFilter;
  /** Filter gewechselt (z. B. für die Adresse der Seite). */
  onFilterChange?: (f: OverviewFilter) => void;
}) {
  const [filter, setFilter] = useState(defaultFilter);
  const choose = (f: OverviewFilter) => { setFilter(f); onFilterChange?.(f); };
  return (
    <div className="co">
      <div role="group" aria-label="Anzeigen" className="co-filter">
        {FILTERS.map(f => <button key={f} type="button" className="co-chip" aria-pressed={filter === f} onClick={() => choose(f)}>{LABEL[f]}</button>)}
      </div>
      <OverviewList key={filter} filter={filter} onOpen={onOpen} />
    </div>
  );
}

function OverviewList({ filter, onOpen }: { filter: OverviewFilter; onOpen: (t: InboxTarget, commentId: string) => void }) {
  const d = useDiscussion();
  const { Loading, ErrorBox, Empty } = d.ui;
  const q = useCommentOverview(filter);
  if (q.isPending) return <Loading label={`${LIST[filter]} werden geladen …`} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.pages.flatMap(p => p.items);
  return (
    <>
      {items.length ? (
        <ol className="co-list" aria-label={LIST[filter]}>
          {items.map(c => <li key={c.id}><OverviewItem c={c} me={d.me} onOpen={onOpen} /></li>)}
        </ol>
      ) : q.hasNextPage ? null
        : filter === 'mine' ? <Empty icon="comment" title="Noch keine Kommentare">Kommentare und Antworten, die du schreibst, erscheinen hier – neueste zuerst.</Empty>
        : filter === 'mentions' ? <Empty icon="at" title="Keine Erwähnungen">Wenn dich jemand in einem Kommentar mit @ erwähnt, erscheint es hier.</Empty>
        : <Empty icon="comment" title="Noch nichts da">Kommentare, die du schreibst, und Stellen, an denen dich jemand mit @ erwähnt, erscheinen hier – neueste zuerst.</Empty>}
      {q.hasNextPage ? <button type="button" className="dk-btn sm co-more" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Lädt …' : 'Ältere laden'}</button> : null}
    </>
  );
}

function OverviewItem({ c, me, onOpen }: { c: OverviewComment; me: string | null; onOpen: (t: InboxTarget, commentId: string) => void }) {
  const mention = c.involvement === 'mention';
  const what = mention ? `${c.author.name} hat dich erwähnt` : c.replyTo ? 'Du hast geantwortet' : 'Du hast kommentiert';
  const open = () => onOpen({ type: c.targetType, id: c.targetId }, c.id);
  // Maus: ganzer Eintrag; Links und Knöpfe darin handeln selbst, markierter Text bleibt markiert
  const onClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('a, button') || window.getSelection()?.toString()) return;
    open();
  };
  return (
    <article className="cm co-item" aria-label={`${what}: ${c.targetTitle}`} onClick={onClick}>
      <span className="dk-avatar" style={{ background: avatarColor(c.author.id) }} aria-hidden="true">{initials(c.author.name)}</span>
      <div className="cm-main">
        <div className="cm-head">
          <button type="button" className="co-target" onClick={open}>{c.targetTitle}</button>
          <time className="dk-muted dk-small" dateTime={String(c.createdAt)} title={fmtDateTime(c.createdAt)}>{relTime(c.createdAt)}</time>
          {c.editedAt ? <span className="dk-muted dk-small" title={`Bearbeitet ${fmtDateTime(c.editedAt)}`}>bearbeitet</span> : null}
        </div>
        <div className={`co-how dk-small dk-muted${mention ? ' is-mention' : ''}`}>
          <Icon name={mention ? 'at' : 'comment'} />
          {mention ? <span><b className="co-who">{c.author.name}</b> hat dich erwähnt</span> : <span>{what}</span>}
        </div>
        <div className="co-text"><CommentText text={c.body ?? ''} mentions={c.mentions} me={me} /></div>
        {c.replyCount ? <div className="dk-muted dk-small">{c.replyCount === 1 ? '1 Antwort' : `${c.replyCount} Antworten`}</div> : null}
      </div>
      <span className="co-go" aria-hidden="true"><Icon name="chevron" /></span>
    </article>
  );
}
