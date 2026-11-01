/** Übersicht der eigenen Kommentare und Erwähnungen: eine Liste mit Filter, Ziel öffnen, eigene Erwähnung, Seiten, Leerzustände, Glocke. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, ME, mockFetch, renderWith } from './utils.tsx';
import { CommentsOverview, NotificationBell } from '../src/index.ts';

afterEach(() => vi.unstubAllGlobals());

const ANNA = { id: ME.id, name: 'Anna Admin' };
const ILSE = { id: '00000000-0000-4000-8000-000000000003', name: 'Ilse Integration' };
const OBJ = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const item = (o: Record<string, unknown> & { id: string }) => ({
  targetType: 'object', targetId: OBJ, objectId: OBJ, targetTitle: 'Laptop 1', author: ANNA, body: 'Text', mentions: [], replyTo: null,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(), editedAt: null, revision: 1, deleted: false, involvement: 'author', replyCount: 0, ...o,
});

describe('Übersicht', () => {
  it('eigene Kommentare und Erwähnungen in einer Liste; ein Eintrag öffnet das Ziel mit der ID des Kommentars', async () => {
    const { calls } = mockFetch({
      'GET /v1/me/comments': () => json({ items: [
        item({ id: 'm1', involvement: 'mention', author: ILSE, body: `@[Anna](${ANNA.id}) bitte prüfen, @[Ilse](${ILSE.id}) weiss Bescheid`, mentions: [ANNA, ILSE], targetType: 'connection', targetId: CONN, objectId: undefined, targetTitle: 'GitHub Org' }),
        item({ id: 'c1', body: 'Akku **tauschen**', replyCount: 2 }),
        item({ id: 'c2', body: 'Erledigt', replyTo: 'c0', editedAt: new Date().toISOString(), targetTitle: 'Laptop 2' }),
      ], nextCursor: null }),
    });
    const onOpen = vi.fn();
    renderWith(<CommentsOverview onOpen={onOpen} />);
    expect(screen.getByRole('button', { name: 'Alle' })).toHaveAttribute('aria-pressed', 'true');
    const list = await screen.findByRole('list', { name: 'Kommentare und Erwähnungen' });
    expect(within(list).getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual([
      'Ilse Integration hat dich erwähnt: GitHub Org', 'Du hast kommentiert: Laptop 1', 'Du hast geantwortet: Laptop 2',
    ]);
    const mention = within(list).getByRole('article', { name: /hat dich erwähnt/ });
    expect(within(mention).getByText('@Anna Admin')).toHaveClass('mention', 'me');
    expect(within(mention).getByText('@Ilse Integration')).not.toHaveClass('me');
    const own = within(list).getByRole('article', { name: 'Du hast kommentiert: Laptop 1' });
    expect(within(own).getByText('tauschen', { selector: 'strong' })).toBeInTheDocument();
    expect(own).toHaveTextContent('2 Antworten');
    expect(within(list).getByRole('article', { name: /Laptop 2/ })).toHaveTextContent('bearbeitet');
    await userEvent.click(within(mention).getByRole('button', { name: 'GitHub Org' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'connection', id: CONN }, 'm1');
    expect(calls.map(c => new URL(c.url).search)).toEqual(['?limit=30']);
  });

  it('ganzer Eintrag öffnet das Ziel; Links im Text und markierter Text nicht', async () => {
    mockFetch({ 'GET /v1/me/comments': () => json({ items: [item({ id: 'c1', body: 'Siehe [Handbuch](https://example.ch/h) dazu' })], nextCursor: null }) });
    const onOpen = vi.fn();
    renderWith(<CommentsOverview onOpen={onOpen} />);
    const card = await screen.findByRole('article', { name: 'Du hast kommentiert: Laptop 1' });
    // Link im Text: eigener Link, öffnet das Ziel nicht (Navigation im Test unterbunden)
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('click', stop);
    await userEvent.click(within(card).getByRole('link', { name: 'Handbuch' }));
    document.removeEventListener('click', stop);
    expect(onOpen).not.toHaveBeenCalled();
    // Text markiert: bleibt markiert, öffnet nicht
    const sel = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Siehe' } as Selection);
    await userEvent.click(within(card).getByText(/Siehe/));
    expect(onOpen).not.toHaveBeenCalled();
    sel.mockRestore();
    await userEvent.click(within(card).getByText(/Siehe/));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ type: 'object', id: OBJ }, 'c1');
  });

  it('Filter grenzen ein, ältere Seiten mit Cursor', async () => {
    const { calls } = mockFetch({
      'GET /v1/me/comments': req => {
        const q = new URL(req.url).searchParams;
        if (q.get('filter') !== 'mentions') return json({ items: [item({ id: 'c1' })], nextCursor: null });
        return q.get('cursor') === 'p2'
          ? json({ items: [item({ id: 'm2', involvement: 'mention', author: ILSE, body: 'Alt', targetTitle: 'Laptop 2' })], nextCursor: null })
          : json({ items: [item({ id: 'm1', involvement: 'mention', author: ILSE, body: 'Neu' })], nextCursor: 'p2' });
      },
    });
    const onFilterChange = vi.fn();
    renderWith(<CommentsOverview onOpen={() => undefined} onFilterChange={onFilterChange} />);
    await screen.findByRole('article', { name: 'Du hast kommentiert: Laptop 1' });
    await userEvent.click(screen.getByRole('button', { name: 'Erwähnungen' }));
    expect(screen.getByRole('button', { name: 'Erwähnungen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Alle' })).toHaveAttribute('aria-pressed', 'false');
    expect(onFilterChange).toHaveBeenCalledWith('mentions');
    expect(await screen.findByRole('article', { name: 'Ilse Integration hat dich erwähnt: Laptop 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByRole('article', { name: 'Ilse Integration hat dich erwähnt: Laptop 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull();
    const q = calls.map(c => new URL(c.url).searchParams);
    expect(q.map(p => [p.get('filter'), p.get('cursor')])).toEqual([[null, null], ['mentions', null], ['mentions', 'p2']]);
  });

  it('beginnt auf Wunsch bei einem Filter und erklärt leere Listen', async () => {
    mockFetch({ 'GET /v1/me/comments': () => json({ items: [], nextCursor: null }) });
    renderWith(<CommentsOverview onOpen={() => undefined} defaultFilter="mentions" />);
    expect(await screen.findByText('Keine Erwähnungen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Meine Kommentare' }));
    expect(await screen.findByText('Noch keine Kommentare')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alle' }));
    expect(await screen.findByText('Noch nichts da')).toBeInTheDocument();
  });

  it('Fehler der API mit erneutem Versuch', async () => {
    let fail = true;
    mockFetch({ 'GET /v1/me/comments': () => (fail ? json({ title: 'Fehler auf dem Server', status: 500 }, 500) : json({ items: [item({ id: 'c1' })], nextCursor: null })) });
    renderWith(<CommentsOverview onOpen={() => undefined} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Fehler auf dem Server');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('article', { name: 'Du hast kommentiert: Laptop 1' })).toBeInTheDocument();
  });
});

describe('Glocke mit Übersicht', () => {
  it('«Alle Kommentare und Erwähnungen» schliesst die Glocke und ruft onShowAll', async () => {
    mockFetch({ 'GET /v1/me/notifications': () => json({ items: [], nextCursor: null, unread: 0 }) });
    const onShowAll = vi.fn();
    renderWith(<NotificationBell onOpen={() => undefined} onShowAll={onShowAll} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Alle Kommentare und Erwähnungen' }));
    expect(onShowAll).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ohne onShowAll kein Link', async () => {
    mockFetch({ 'GET /v1/me/notifications': () => json({ items: [], nextCursor: null, unread: 0 }) });
    renderWith(<NotificationBell onOpen={() => undefined} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen' }));
    expect(screen.queryByRole('button', { name: 'Alle Kommentare und Erwähnungen' })).toBeNull();
  });
});
