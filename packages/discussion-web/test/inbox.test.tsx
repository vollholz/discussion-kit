/** Glocke in der Kopfzeile: Zahl der ungelesenen, Liste, Ziel öffnen und als gelesen markieren, nicht sichtbare Ziele, weitere Arten der App. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch, renderWith } from './utils.tsx';
import { NotificationBell } from '../src/index.ts';

afterEach(() => vi.unstubAllGlobals());

const ILSE = { id: '00000000-0000-4000-8000-000000000003', name: 'Ilse Integration' };
const CONN = '22222222-2222-4222-8222-222222222222';
const OBJ = '11111111-1111-4111-8111-111111111111';
const note = (o: Record<string, unknown> & { id: string }) => ({
  kind: 'mention', createdAt: new Date(Date.now() - 60_000).toISOString(), readAt: null, actor: ILSE,
  target: { type: 'connection', id: CONN, title: 'GitHub Org', available: true },
  subject: { type: 'comment', id: 'c1', excerpt: 'Token läuft ab, @Rita bitte prüfen' }, ...o,
});

function routes(items: unknown[], unread: number) {
  return mockFetch({
    'GET /v1/me/notifications': () => json({ items, nextCursor: null, unread }),
    'POST /v1/me/notifications/read': () => json({ updated: 1 }),
  });
}

describe('Glocke', () => {
  it('zeigt die ungelesenen, öffnet das Ziel und markiert den Eintrag als gelesen', async () => {
    const { calls } = routes([
      note({ id: 'n1' }),
      note({ id: 'n2', kind: 'reply', readAt: new Date().toISOString(), target: { type: 'object', id: OBJ, title: 'Laptop 1', available: true }, subject: { type: 'comment', id: 'c2', excerpt: 'Erledigt' } }),
    ], 1);
    const onOpen = vi.fn();
    renderWith(<NotificationBell onOpen={onOpen} />);
    const bell = await screen.findByRole('button', { name: 'Benachrichtigungen, 1 ungelesen' });
    await userEvent.click(bell);
    const dlg = screen.getByRole('dialog', { name: 'Benachrichtigungen' });
    const items = within(dlg).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ilse Integration hat dich erwähnt · GitHub Org');
    expect(items[0]).toHaveTextContent('Token läuft ab, @Rita bitte prüfen');
    expect(items[0]).toHaveTextContent('ungelesen');
    expect(items[1]).toHaveTextContent('hat auf deinen Kommentar geantwortet · Laptop 1');
    await userEvent.click(within(items[0]!).getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith({ type: 'connection', id: CONN }, 'c1', expect.objectContaining({ id: 'n1', kind: 'mention' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.url.endsWith('/v1/me/notifications/read'))).toBe(true));
    const post = calls.find(c => c.method === 'POST')!;
    expect(await post.json()).toEqual({ ids: ['n1'] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Ziel nicht (mehr) sichtbar: Eintrag erscheint nicht, ungelesener gilt als gelesen', async () => {
    const gone = note({ id: 'n1', actor: null, target: { type: 'object', id: OBJ, title: null, available: false }, subject: { type: 'comment', id: 'c1', excerpt: null } });
    const { calls } = routes([gone, note({ id: 'n2' }), { ...gone, id: 'n3', readAt: new Date().toISOString() }], 2);
    renderWith(<NotificationBell onOpen={() => undefined} />);
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true));
    expect(await calls.find(c => c.method === 'POST')!.json()).toEqual({ ids: ['n1'] });
    await userEvent.click(await screen.findByRole('button', { name: /Benachrichtigungen/ }));
    const items = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Ilse Integration hat dich erwähnt · GitHub Org');
    expect(screen.queryByText(/nicht mehr sichtbar/)).toBeNull();
  });

  it('«Alle als gelesen markieren», Esc schliesst und gibt den Fokus an die Glocke zurück, leere Liste erklärt sich', async () => {
    const { calls } = routes([note({ id: 'n1' }), note({ id: 'n2' })], 2);
    renderWith(<NotificationBell onOpen={() => undefined} />);
    const bell = await screen.findByRole('button', { name: 'Benachrichtigungen, 2 ungelesen' });
    await userEvent.click(bell);
    await userEvent.click(screen.getByRole('button', { name: 'Alle als gelesen markieren' }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true));
    expect(await calls.find(c => c.method === 'POST')!.json()).toEqual({ all: true });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bell).toHaveFocus();
  });

  it('ohne Benachrichtigungen', async () => {
    routes([], 0);
    renderWith(<NotificationBell onOpen={() => undefined} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen' }));
    expect(await screen.findByText(/Keine Benachrichtigungen/)).toBeInTheDocument();
  });

  it('weitere Arten: Darstellung der App, allgemeiner Text für unbekannte, Öffnen mit dem ganzen Eintrag', async () => {
    const CASE = '33333333-3333-4333-8333-333333333333';
    const task = (o: Record<string, unknown> & { id: string }) => note({
      kind: 'task_assigned', target: { type: 'case', id: CASE, title: 'Offerte Müller', available: true }, subject: { type: 'task', id: 't1', excerpt: 'Fällig am Freitag' }, ...o,
    });
    routes([
      task({ id: 'n1' }),
      task({ id: 'n2', kind: 'sla_breached', actor: null, subject: { type: 'task', id: 't2', excerpt: null } }),
      task({ id: 'n3', kind: 'run_failed', subject: { type: 'workflow_run', id: 'r1', excerpt: null } }),
      task({ id: 'n4', kind: 'approval_requested', actor: null, subject: { type: 'task', id: 't3', excerpt: null } }),
      note({ id: 'n5' }),
    ], 5);
    const onOpen = vi.fn();
    renderWith(<NotificationBell onOpen={onOpen} />, {
      config: {
        notificationKinds: {
          task_assigned: { text: n => <><b>{n.actor?.name}</b> hat dir eine Aufgabe zugewiesen</> },
          sla_breached: { text: () => 'Frist überschritten', icon: <span data-testid="sla-icon">!</span> },
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen, 5 ungelesen' }));
    const items = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ilse Integration hat dir eine Aufgabe zugewiesen · Offerte Müller');
    expect(items[0]).toHaveTextContent('Fällig am Freitag');
    expect(items[1]).toHaveTextContent('Frist überschritten · Offerte Müller');
    expect(within(items[1]!).getByTestId('sla-icon')).toBeInTheDocument();
    // Unbekannte Arten: allgemeiner Text, mit oder ohne Person
    expect(items[2]).toHaveTextContent('Neue Benachrichtigung von Ilse Integration · Offerte Müller');
    expect(items[3]).toHaveTextContent(/^Neue Benachrichtigung · Offerte Müller/);
    // Erwähnungen unverändert
    expect(items[4]).toHaveTextContent('Ilse Integration hat dich erwähnt · GitHub Org');
    await userEvent.click(within(items[2]!).getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith({ type: 'case', id: CASE }, 'r1', expect.objectContaining({ kind: 'run_failed', subject: { type: 'workflow_run', id: 'r1', excerpt: null } }));
  });
});
