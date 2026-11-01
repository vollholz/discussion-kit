/** Übersicht der eigenen Kommentare und Erwähnungen: Reiter, Ziel öffnen, eigene Erwähnung, Seiten, Leerzustände, Glocke. */
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
  createdAt: new Date(Date.now() - 3_600_000).toISOString(), editedAt: null, revision: 1, deleted: false, replyCount: 0, ...o,
});

describe('Übersicht', () => {
  it('zeigt eigene Kommentare mit Ziel und Antworten; das Ziel öffnet die App mit der ID des Kommentars', async () => {
    const { calls } = mockFetch({
      'GET /v1/me/comments': () => json({ items: [
        item({ id: 'c1', body: 'Akku **tauschen**', replyCount: 2 }),
        item({ id: 'c2', body: 'Erledigt', replyTo: 'c0', targetType: 'connection', targetId: CONN, objectId: undefined, targetTitle: 'GitHub Org', editedAt: new Date().toISOString() }),
      ], nextCursor: null }),
    });
    const onOpen = vi.fn();
    renderWith(<CommentsOverview onOpen={onOpen} />);
    expect(screen.getByRole('tab', { name: 'Meine Kommentare' })).toHaveAttribute('aria-selected', 'true');
    const first = await screen.findByRole('article', { name: 'Du hast kommentiert: Laptop 1' });
    expect(within(first).getByText('tauschen', { selector: 'strong' })).toBeInTheDocument();
    expect(first).toHaveTextContent('2 Antworten');
    const second = screen.getByRole('article', { name: 'Du hast geantwortet: GitHub Org' });
    expect(second).toHaveTextContent('bearbeitet');
    await userEvent.click(within(second).getByRole('button', { name: 'GitHub Org' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'connection', id: CONN }, 'c2');
    expect(calls.map(c => new URL(c.url).pathname)).toEqual(['/v1/me/comments']);
  });

  it('Erwähnungen per Pfeiltaste, die eigene Erwähnung hervorgehoben, ältere Seiten mit Cursor', async () => {
    const { calls } = mockFetch({
      'GET /v1/me/comments': () => json({ items: [], nextCursor: null }),
      'GET /v1/me/mentions': req => new URL(req.url).searchParams.get('cursor') === 'p2'
        ? json({ items: [item({ id: 'm2', author: ILSE, body: 'Alt', targetTitle: 'Laptop 2' })], nextCursor: null })
        : json({ items: [item({ id: 'm1', author: ILSE, body: `@[Anna](${ANNA.id}) bitte prüfen, @[Ilse](${ILSE.id}) weiss Bescheid`, mentions: [ANNA, ILSE] })], nextCursor: 'p2' }),
    });
    renderWith(<CommentsOverview onOpen={() => undefined} />);
    await screen.findByText('Noch keine Kommentare');
    screen.getByRole('tab', { name: 'Meine Kommentare' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    const tab = screen.getByRole('tab', { name: 'Erwähnungen' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveFocus();
    const m1 = await screen.findByRole('article', { name: 'Ilse Integration hat dich erwähnt: Laptop 1' });
    expect(within(m1).getByText('@Anna Admin')).toHaveClass('mention', 'me');
    expect(within(m1).getByText('@Ilse Integration')).not.toHaveClass('me');
    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByRole('article', { name: 'Ilse Integration hat dich erwähnt: Laptop 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull();
    expect(calls.filter(c => new URL(c.url).pathname === '/v1/me/mentions').map(c => new URL(c.url).searchParams.get('cursor'))).toEqual([null, 'p2']);
  });

  it('beginnt auf Wunsch bei den Erwähnungen und erklärt leere Listen', async () => {
    mockFetch({ 'GET /v1/me/mentions': () => json({ items: [], nextCursor: null }) });
    const onViewChange = vi.fn();
    renderWith(<CommentsOverview onOpen={() => undefined} defaultView="mentions" onViewChange={onViewChange} />);
    expect(await screen.findByText('Keine Erwähnungen')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Erwähnungen');
    expect(onViewChange).not.toHaveBeenCalled();
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
