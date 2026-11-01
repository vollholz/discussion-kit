/**
 * Kommentare an einem Ziel: Verlauf mit Antworten (eine Ebene), Schreiben mit Erwähnung (@ öffnet die
 * Personensuche, Pfeiltasten wählen, Enter oder Tab übernimmt), Bearbeiten eigener Kommentare mit sichtbarem
 * Verlauf früherer Stände, Löschen (eigene oder mit Moderationsrecht). Text wird ohne HTML dargestellt (markdown.tsx).
 * Rechte am Ziel (`can.comment`, `can.moderateComments`: Rolle, Freigaben und Verbote je Bereich), wie die API sie
 * beim Speichern prüft; ohne `can` gilt das Recht auf Ebene der Organisation.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { mentionToken, request, useCommentMutations, useComments, dkKeys, type Comment, type PersonRef, type Revision, type Target } from './api.ts';
import { useDiscussion, useToaster, type Person } from './config.tsx';
import { CommentText } from './markdown.tsx';
import { allowed, type DiscussionCan } from './can.ts';
import { avatarColor, fmtDateTime, Icon, initials, relTime } from './ui.tsx';

const MAX = 10_000;
/** «@» am Wortanfang bis zur Schreibmarke, danach höchstens 40 Zeichen ohne Zeilenumbruch und ohne weiteres @. */
const TRIGGER = /(^|[\s(])@([^\s@[\]()]{0,40}(?: [^\s@[\]()]{0,40})?)$/;

export function CommentsPanel({ target, can: caps }: { target: Target; can?: DiscussionCan }) {
  const d = useDiscussion();
  const q = useComments(target);
  const text = d.targets[target.type]!;
  const can = d.can;
  const { Loading, ErrorBox, Empty, MissingRight } = d.ui;
  const write = allowed(d, caps, 'comment', 'comment:write');
  const moderate = allowed(d, caps, 'moderateComments', 'comment:moderate');
  const me = d.me;
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  if (q.isPending) return <Loading label="Kommentare werden geladen …" />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const all = q.data.pages.flatMap(p => p.items);
  const roots = all.filter(c => !c.replyTo || !all.some(r => r.id === c.replyTo));
  const replies = (id: string) => all.filter(c => c.replyTo === id);
  return (
    <div className="discussion">
      {all.length ? (
        <ol className="cm-list" aria-label="Kommentare">
          {roots.map(c => (
            <li key={c.id}>
              <CommentItem c={c} me={me} target={target} write={write} moderate={moderate} onReply={write ? () => setReplyTo(c) : undefined} />
              {replies(c.id).length || replyTo?.id === c.id ? (
                <ol className="cm-replies" aria-label={`Antworten an ${c.author.name}`}>
                  {replies(c.id).map(r => <li key={r.id}><CommentItem c={r} me={me} target={target} write={write} moderate={moderate} onReply={write ? () => setReplyTo(c) : undefined} /></li>)}
                  {replyTo?.id === c.id ? <li><Composer target={target} replyTo={c} onDone={() => setReplyTo(null)} /></li> : null}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      ) : <Empty icon="comment" title="Noch keine Kommentare">{write ? `Fragen, Hinweise und Absprachen ${text.here} gehören hierher. Mit @ erwähnst du eine Person.` : `Kommentare ${text.here} erscheinen hier.`}</Empty>}
      {q.hasNextPage ? <button type="button" className="dk-btn sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Lädt …' : 'Weitere Kommentare laden'}</button> : null}
      {write ? <Composer target={target} />
        : can('comment:write') ? <p className="dk-muted dk-small dk-missing">Du kannst Kommentare lesen. {text.restricted} ist der Zugriff eingeschränkt. Fragen dazu beantwortet die Organisations-Administration.</p>
        : <MissingRight perm="comment:write" lead="Du kannst Kommentare lesen. Zum Schreiben" />}
    </div>
  );
}

function CommentItem({ c, me, target, write, moderate, onReply }: { c: Comment; me: string | null; target: Target; write: boolean; moderate: boolean; onReply?: () => void }) {
  const toast = useToaster();
  const { Confirm } = useDiscussion().ui;
  const m = useCommentMutations(target);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showRevs, setShowRevs] = useState(false);
  if (c.deleted) return <article className="cm deleted" aria-label="Gelöschter Kommentar"><p className="dk-muted dk-small">Kommentar gelöscht</p></article>;
  const mine = !!me && c.author.id === me;
  const canEdit = mine && write;
  const canDelete = canEdit || moderate;
  return (
    <article className="cm" aria-label={`Kommentar von ${c.author.name}`}>
      <span className="dk-avatar" style={{ background: avatarColor(c.author.id) }} aria-hidden="true">{initials(c.author.name)}</span>
      <div className="cm-main">
        <div className="cm-head">
          <b>{c.author.name}</b>
          <time className="dk-muted dk-small" dateTime={String(c.createdAt)} title={fmtDateTime(c.createdAt)}>{relTime(c.createdAt)}</time>
          {c.editedAt ? <button type="button" className="dk-link dk-small" aria-expanded={showRevs} onClick={() => setShowRevs(v => !v)} title={`Bearbeitet ${fmtDateTime(c.editedAt)}`}>bearbeitet</button> : null}
        </div>
        {editing ? (
          <Composer target={target} edit={c} onDone={() => setEditing(false)} />
        ) : <CommentText text={c.body ?? ''} mentions={c.mentions} />}
        {showRevs ? <Revisions id={c.id} /> : null}
        {!editing ? (
          <div className="cm-actions">
            {onReply ? <button type="button" className="dk-btn sm ghost" onClick={onReply}><Icon name="reply" />Antworten</button> : null}
            {canEdit ? <button type="button" className="dk-btn sm ghost" onClick={() => setEditing(true)}><Icon name="edit" />Bearbeiten</button> : null}
            {canDelete ? <button type="button" className="dk-btn sm ghost" onClick={() => setConfirm(true)} aria-label={mine ? 'Kommentar löschen' : `Kommentar von ${c.author.name} löschen`}><Icon name="trash" />Löschen</button> : null}
          </div>
        ) : null}
      </div>
      {confirm ? (
        <Confirm title="Kommentar löschen?" confirm="Löschen" danger busy={m.remove.isPending} onClose={() => setConfirm(false)}
          onConfirm={() => m.remove.mutate(c.id, { onSuccess: () => { setConfirm(false); toast.show('Kommentar gelöscht'); }, onError: e => { setConfirm(false); toast.error(e, 'Nicht gelöscht'); } })}>
          <p>{mine ? 'Dein Kommentar wird entfernt.' : `Der Kommentar von ${c.author.name} wird entfernt.`} Antworten darauf bleiben stehen.</p>
        </Confirm>
      ) : null}
    </article>
  );
}

function Revisions({ id }: { id: string }) {
  const d = useDiscussion();
  const { Loading, ErrorBox } = d.ui;
  const q = useQuery({ queryKey: dkKeys.revisions(id), queryFn: () => request<{ items: Revision[] }>(d, 'GET', `/v1/comments/${encodeURIComponent(id)}/revisions`).then(r => r.items) });
  if (q.isPending) return <Loading inline label="Frühere Stände werden geladen …" />;
  if (q.error) return <ErrorBox error={q.error} compact onRetry={() => void q.refetch()} />;
  return (
    <ol className="cm-revs" aria-label="Frühere Stände">
      {q.data.map(r => (
        <li key={r.revision}>
          <div className="dk-muted dk-small">Stand {r.revision} · geschrieben {fmtDateTime(r.writtenAt)}, ersetzt {fmtDateTime(r.replacedAt)}</div>
          <CommentText text={r.body} mentions={r.mentions} />
        </li>
      ))}
    </ol>
  );
}

/** Erwähnung im Format des Servers. */
const TOKEN = /@\[([^\]\n]{1,200})\]\(([0-9a-fA-F-]{36})\)/g;
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** «@Name» der gewählten Personen, längste Namen zuerst, nicht mitten in einem Wort endend. */
const mentionRe = (people: PersonRef[]) => people.length
  ? new RegExp(`@(${[...people].sort((a, b) => b.name.length - a.name.length).map(p => escapeRe(p.name)).join('|')})(?![\\p{L}\\p{N}_])`, 'gu')
  : null;

/** Gespeicherter Text → Anzeige im Feld («@Name») und die erwähnten Personen. */
function toDisplay(body: string): { text: string; people: PersonRef[] } {
  const people: PersonRef[] = [];
  const text = body.replace(TOKEN, (_m, name: string, id: string) => {
    if (!people.some(p => p.id === id)) people.push({ id, name });
    return `@${name}`;
  });
  return { text, people };
}

/** Anzeige im Feld → Text für den Server: «@Name» gewählter Personen wird zu «@[Name](id)». */
function toBody(text: string, people: PersonRef[]): string {
  const re = mentionRe(people);
  return re ? text.replace(re, (_m, name: string) => mentionToken(people.find(p => p.name === name)!)) : text;
}

/** Erwähnte Personen, deren «@Name» noch im Text steht. */
function mentionedIn(text: string, people: PersonRef[]): PersonRef[] {
  const re = mentionRe(people);
  if (!re) return [];
  const names = new Set([...text.matchAll(re)].map(m => m[1]!));
  return people.filter(p => names.has(p.name));
}

/** Text des Felds mit hervorgehobenen Erwähnungen (Ebene hinter der Textarea, gleiche Masse). */
function Mirror({ text, people, scroll }: { text: string; people: PersonRef[]; scroll: number }) {
  const re = mentionRe(people);
  const parts: ReactNode[] = [];
  let last = 0, i = 0;
  if (re) for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={i++} className="cm-mark">{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last), '\u200b');
  return <div className="cm-mirror" aria-hidden="true" style={{ transform: `translateY(${-scroll}px)` }}>{parts}</div>;
}

/** Eingabe für neue Kommentare, Antworten und Bearbeitungen, mit Personensuche nach «@». */
function Composer({ target, replyTo, edit, onDone }: { target: Target; replyTo?: Comment; edit?: Comment; onDone?: () => void }) {
  const d = useDiscussion();
  const { ErrorBox } = d.ui;
  const toast = useToaster();
  const m = useCommentMutations(target);
  const initial = useMemo(() => toDisplay(edit?.body ?? ''), [edit?.body]);
  const [text, setText] = useState(initial.text);
  /** Gewählte Personen; erwähnt ist, wessen «@Name» noch im Text steht. */
  const [chosen, setChosen] = useState<PersonRef[]>(() => [...initial.people, ...(edit?.mentions ?? []).filter(m => !initial.people.some(p => p.id === m.id))]);
  const [scroll, setScroll] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId(), hintId = useId(), labelId = useId();
  const busy = m.create.isPending || m.update.isPending;

  useEffect(() => { if (replyTo || edit) ref.current?.focus(); }, [replyTo, edit]);

  // Personensuche, sobald nach «@» getippt wird (verzögert)
  useEffect(() => {
    if (query === null) return;
    let alive = true;
    setSearchState('loading');
    const t = setTimeout(() => {
      d.searchPeople(query, 8).then(r => { if (alive) { setPeople(r); setIdx(0); setSearchState('idle'); } }, () => { if (alive) { setPeople([]); setSearchState('error'); } });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [query, d]);

  const detect = (value: string, caret: number) => {
    const m2 = TRIGGER.exec(value.slice(0, caret));
    setQuery(m2 ? m2[2]! : null);
  };
  const pick = (p: Person) => {
    const el = ref.current!;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret), after = text.slice(caret);
    const m2 = TRIGGER.exec(before);
    if (!m2) return;
    const start = before.length - m2[2]!.length - 1;
    const name = p.name.replace(/[[\]\n]/g, ' ').trim();
    const token = `@${name} `;
    const next = before.slice(0, start) + token + after;
    setChosen(list => [...list.filter(x => x.id !== p.id && x.name !== name), { id: p.id, name }]);
    setText(next); setQuery(null);
    requestAnimationFrame(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos); });
  };
  const insertAt = () => {
    const el = ref.current!;
    const caret = el.selectionStart ?? text.length;
    const pre = text.slice(0, caret);
    const ins = (pre && !/\s$/.test(pre) ? ' @' : '@');
    const next = pre + ins + text.slice(caret);
    setText(next);
    requestAnimationFrame(() => { el.focus(); const pos = caret + ins.length; el.setSelectionRange(pos, pos); detect(next, pos); });
  };

  const submit = () => {
    const body = toBody(text, chosen).trim();
    if (!body || busy) return;
    setError(null);
    const done = (msg: string) => () => { setText(''); setChosen([]); setQuery(null); toast.show(msg); onDone?.(); };
    if (edit) m.update.mutate({ id: edit.id, body, revision: edit.revision }, { onSuccess: done('Kommentar geändert'), onError: setError });
    else m.create.mutate({ body, ...(replyTo ? { replyTo: replyTo.id } : {}) }, { onSuccess: done(replyTo ? 'Antwort gespeichert' : 'Kommentar gespeichert'), onError: setError });
  };

  const open = query !== null;
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && people.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, people.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(people[Math.min(idx, people.length - 1)]!); return; }
    }
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); return; }
    if (e.key === 'Escape' && (edit || replyTo)) { e.preventDefault(); e.stopPropagation(); onDone?.(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  };

  const mentioned = useMemo(() => mentionedIn(text, chosen).map(p => p.name), [text, chosen]);
  // Schliessen beim Verlassen nur, wenn der Fokus das Formular verlässt (sonst schlösse z. B. «@ Person erwähnen» die
  // eben geöffnete Auswahl wieder: Flackern)
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const onBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (formRef.current?.contains(e.relatedTarget as Node | null)) return;
    cancelClose();
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setQuery(null); }, 150);
  };
  useEffect(() => cancelClose, []);
  const label = edit ? 'Kommentar bearbeiten' : replyTo ? `Antwort an ${replyTo.author.name}` : 'Neuer Kommentar';

  return (
    <form ref={formRef} className={`cm-compose${replyTo || edit ? ' inline' : ''}`} onSubmit={e => { e.preventDefault(); submit(); }} aria-labelledby={labelId}>
      {/* «Neuer Kommentar» nur für Screenreader (Überschrift und Platzhalter sagen es); Antwort an … und Bearbeiten sichtbar */}
      <label id={labelId} className={replyTo || edit ? 'dk-small dk-muted' : 'dk-sr'} htmlFor={`${listId}-ta`}>{label}</label>
      <div className="cm-input">
        <div className="cm-mirror-wrap" aria-hidden="true"><Mirror text={text} people={chosen} scroll={scroll} /></div>
        <textarea id={`${listId}-ta`} ref={ref} value={text} rows={replyTo || edit ? 2 : 3} maxLength={MAX} disabled={busy}
          placeholder={replyTo ? 'Antworten …' : 'Kommentar schreiben … (@ erwähnt eine Person)'}
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-describedby={mentioned.length ? hintId : undefined}
          aria-activedescendant={open && people[idx] ? `${listId}-${idx}` : undefined}
          onChange={e => { setText(e.target.value); detect(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onClick={e => detect(text, (e.target as HTMLTextAreaElement).selectionStart ?? text.length)}
          onKeyDown={onKey} onFocus={cancelClose} onBlur={onBlur} onScroll={e => setScroll((e.target as HTMLTextAreaElement).scrollTop)} />
        {open ? (
          <div className="cm-suggest">
            <div role="status" aria-live="polite" className="dk-small dk-muted">
              {searchState === 'loading' && !people.length ? 'Personen werden gesucht …' : searchState === 'error' ? 'Suche fehlgeschlagen' : !people.length ? 'Keine Person gefunden' : `${people.length} ${people.length === 1 ? 'Person' : 'Personen'} gefunden`}
            </div>
            <ul id={listId} role="listbox" aria-label="Person erwähnen">
              {people.map((p, i) => (
                <li key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === idx} className={i === idx ? 'on' : ''}
                  onMouseDown={e => { e.preventDefault(); pick(p); }} onMouseEnter={() => setIdx(i)}>
                  <span className="dk-avatar sm" style={{ background: avatarColor(p.id) }} aria-hidden="true">{initials(p.name)}</span>
                  <span>{p.name}</span>{p.email ? <span className="dk-muted dk-small">{p.email}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {mentioned.length ? <div id={hintId} className="dk-small dk-muted">Erwähnt: {mentioned.map((n, i) => <span key={i} className="mention">@{n}</span>)}</div> : null}
      {error ? <ErrorBox error={error} compact /> : null}
      <div className="cm-buttons">
        <button type="button" className="dk-btn sm ghost" onMouseDown={e => e.preventDefault()} onClick={insertAt} disabled={busy}>@ Person erwähnen</button>
        <span className="dk-spacer" />
        {onDone ? <button type="button" className="dk-btn sm ghost" onClick={onDone}>Abbrechen</button> : null}
        <button type="submit" className="dk-btn sm primary" disabled={busy || !text.trim()}>{busy ? 'Wird gespeichert …' : edit ? 'Speichern' : replyTo ? 'Antworten' : 'Kommentieren'}</button>
      </div>
    </form>
  );
}
