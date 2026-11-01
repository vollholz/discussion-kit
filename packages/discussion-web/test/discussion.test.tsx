/** Kommentare und Anhänge im Objektdetail: sichere Darstellung, Erwähnung per Tastatur, Rechte, Upload mit Fortschritt. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, ME, mockFetch, renderWith } from './utils.tsx';
import { AttachmentsPanel, CommentsPanel, CommentText } from '../src/index.ts';

afterEach(() => vi.unstubAllGlobals());

const OBJ = '11111111-1111-4111-8111-111111111111';
const ANNA = { id: '00000000-0000-4000-8000-000000000001', name: 'Anna Admin' };
const CARLA = { id: '00000000-0000-4000-8000-000000000002', name: 'Carla Prüferin' };
const comment = (o: Partial<Record<string, unknown>> & { id: string }) => ({
  objectId: OBJ, author: ANNA, body: 'Text', mentions: [], replyTo: null, createdAt: new Date(Date.now() - 120_000).toISOString(), editedAt: null, revision: 1, deleted: false, ...o,
});
const att = (o: Partial<Record<string, unknown>> & { id: string; name: string }) => ({
  objectId: OBJ, size: 2048, mediaType: 'application/pdf', sha256: 'a'.repeat(64), uploadedBy: ANNA, uploadedAt: new Date().toISOString(), preview: false, ...o,
});
const WRITE = { permissions: [...ME.permissions, 'comment:write', 'attachment:write'] };
/** Fähigkeiten am Objekt (`can` der API: Rolle, Freigaben und Verbote je Bereich). */
const T = { type: 'object' as const, id: OBJ };
const CAN = (o: Partial<Record<'comment' | 'moderateComments' | 'attach' | 'deleteAttachments', boolean>>) => ({ can: { write: false, delete: false, access: false, classify: false, comment: false, moderateComments: false, attach: false, deleteAttachments: false, ...o } });

describe('Kommentartext', () => {
  it('stellt die Markdown-Teilmenge dar, ohne HTML zu interpretieren', () => {
    const { container } = render(<CommentText text={'**Fett** und *kursiv* mit `code`\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n- eins\n- zwei\n\n[Doku](https://example.ch/a) [böse](javascript:alert(1)) https://example.ch/b.'} mentions={[]} />);
    expect(container.querySelector('strong')).toHaveTextContent('Fett');
    expect(container.querySelector('em')).toHaveTextContent('kursiv');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    const links = [...container.querySelectorAll('a')];
    expect(links.map(a => a.getAttribute('href'))).toEqual(['https://example.ch/a', 'https://example.ch/b']);
    expect(links.every(a => a.rel.includes('noopener') && a.target === '_blank')).toBe(true);
    expect(container).toHaveTextContent('[böse](javascript:alert(1))');
  });

  it('zeigt Erwähnungen mit aktuellem Namen', () => {
    render(<CommentText text={`Hallo @[Carla alt](${CARLA.id})!`} mentions={[CARLA]} />);
    expect(screen.getByText('@Carla Prüferin')).toHaveClass('mention');
  });
});

function commentRoutes(items: unknown[], over: Record<string, (req: Request) => Response | Promise<Response>> = {}) {
  return mockFetch({
    'GET /v1/me': () => json({ principal: ANNA }),
    [`GET /v1/objects/${OBJ}/comments`]: () => json({ items, nextCursor: null, total: items.length }),
    'GET /v1/people': req => {
      const q = (new URL(req.url).searchParams.get('q') ?? '').toLowerCase();
      return json({ items: [ANNA, CARLA].filter(p => p.name.toLowerCase().includes(q)).map(p => ({ ...p, kind: 'user', email: `${p.name.split(' ')[0]!.toLowerCase()}@demo.example`, clientId: null, lastSeenAt: null })), nextCursor: null });
    },
    ...over,
  });
}

describe('Reiter Kommentare', () => {
  it('zeigt Antworten unter dem Ausgangskommentar, Platzhalter für gelöschte, Aktionen nur für Berechtigte', async () => {
    commentRoutes([
      comment({ id: 'c1', body: 'Frage', author: CARLA }),
      comment({ id: 'c2', body: 'Antwort von Anna', replyTo: 'c1', editedAt: new Date().toISOString(), revision: 2 }),
      comment({ id: 'c3', body: null, deleted: true }),
    ]);
    renderWith(<CommentsPanel target={T} />, { me: WRITE });
    const first = await screen.findByRole('article', { name: 'Kommentar von Carla Prüferin' });
    expect(within(first).queryByRole('button', { name: /Bearbeiten/ })).toBeNull();
    expect(within(first).queryByRole('button', { name: /löschen/i })).toBeNull();
    const replies = screen.getByRole('list', { name: 'Antworten an Carla Prüferin' });
    const own = within(replies).getByRole('article', { name: 'Kommentar von Anna Admin' });
    await waitFor(() => expect(within(own).getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument());
    expect(within(own).getByRole('button', { name: 'bearbeitet' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('article', { name: 'Gelöschter Kommentar' })).toHaveTextContent('Kommentar gelöscht');
  });

  it('erwähnt per @ mit Personensuche und Tastatur und sendet mit Strg+Enter', async () => {
    let posted: unknown = null;
    const { calls } = commentRoutes([], {
      [`POST /v1/objects/${OBJ}/comments`]: async req => { posted = await req.json(); return json(comment({ id: 'n1', body: (posted as { body: string }).body, mentions: [CARLA] }), 201); },
    });
    renderWith(<CommentsPanel target={T} />, { me: WRITE });
    expect(await screen.findByText('Noch keine Kommentare')).toBeInTheDocument();
    const box = screen.getByRole('combobox', { name: 'Neuer Kommentar' });
    await userEvent.type(box, 'Bitte prüfen @car');
    const list = await screen.findByRole('listbox', { name: 'Person erwähnen' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(1));
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', within(list).getByRole('option').id);
    expect(screen.getByText('1 Person gefunden')).toHaveAttribute('role', 'status');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue(`Bitte prüfen @[Carla Prüferin](${CARLA.id}) `);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('@Carla Prüferin')).toHaveClass('mention');
    // Die Auswahl setzt den Cursor im nächsten Frame; erst danach weitertippen
    await act(() => new Promise<void>(r => requestAnimationFrame(() => r())));
    await userEvent.type(box, 'danke');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(posted).toEqual({ body: `Bitte prüfen @[Carla Prüferin](${CARLA.id}) danke` }));
    expect(calls.find(c => c.method === 'POST')!.headers.get('x-csrf-token')).toBe('csrf-123');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('Escape schliesst die Personensuche; Fehler beim Speichern bleiben sichtbar', async () => {
    commentRoutes([], { [`POST /v1/objects/${OBJ}/comments`]: () => json({ title: 'Ungültige Eingabe', status: 422, detail: 'Erwähnte Person unbekannt.' }, 422) });
    renderWith(<CommentsPanel target={T} />, { me: WRITE });
    const box = await screen.findByRole('combobox', { name: 'Neuer Kommentar' });
    await userEvent.type(box, '@');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.type(box, 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Erwähnte Person unbekannt.');
  });

  it('ohne comment:write nur lesen; Ladefehler mit Erneut versuchen', async () => {
    let fail = true;
    commentRoutes([], { [`GET /v1/objects/${OBJ}/comments`]: () => (fail ? json({ title: 'Serverfehler', status: 500 }, 500) : json({ items: [comment({ id: 'c1', body: 'Hallo' })], nextCursor: null, total: 1 })) });
    renderWith(<CommentsPanel target={T} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Serverfehler');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Hallo')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(await screen.findByText(/Zum Schreiben fehlt dir das Recht «Kommentieren»\. Rechte vergibt die Administration deiner Organisation\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Antworten' })).toBeNull();
  });

  it('Freigabe nur in diesem Bereich: Leserin schreibt und antwortet, obwohl die Rolle es nicht enthält', async () => {
    commentRoutes([comment({ id: 'c1', body: 'Frage', author: CARLA })]);
    // Rolle ohne comment:write, aber `can.comment` am Objekt (Freigabe im Schema)
    renderWith(<CommentsPanel target={T} can={CAN({ comment: true }).can} />);
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Antworten' })).toBeInTheDocument();
    expect(screen.queryByText(/fehlt dir das Recht/)).toBeNull();
  });

  it('Verbot in diesem Bereich: Rolle mit comment:write sieht kein Formular, sondern den Grund; eigene Kommentare nicht bearbeitbar', async () => {
    commentRoutes([comment({ id: 'c1', body: 'Eigener' })]);
    renderWith(<CommentsPanel target={T} can={CAN({}).can} />, { me: WRITE });
    expect(await screen.findByText('Eigener')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/Für dieses Objekt ist der Zugriff eingeschränkt/)).toBeInTheDocument();
    const own = screen.getByRole('article', { name: 'Kommentar von Anna Admin' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Antworten' })).toBeNull());
    expect(within(own).queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(within(own).queryByRole('button', { name: /löschen/i })).toBeNull();
  });

  it('Moderation am Objekt: fremde Kommentare löschen nur mit `can.moderateComments`', async () => {
    commentRoutes([comment({ id: 'c1', body: 'Fremd', author: CARLA })]);
    renderWith(<CommentsPanel target={T} can={CAN({ comment: true, moderateComments: true }).can} />);
    const other = await screen.findByRole('article', { name: 'Kommentar von Carla Prüferin' });
    expect(within(other).getByRole('button', { name: 'Kommentar von Carla Prüferin löschen' })).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
  });
});

/** XMLHttpRequest-Ersatz: meldet Fortschritt und antwortet wie vorgegeben. */
function fakeXhr(respond: (body: Blob, headers: Record<string, string>) => { status: number; body: unknown }) {
  const sent: { url: string; headers: Record<string, string>; body: Blob }[] = [];
  class X {
    status = 0; responseText = ''; upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    onload?: () => void; onerror?: () => void; onabort?: () => void;
    private url = ''; private headers: Record<string, string> = {};
    open(_m: string, url: string) { this.url = url; }
    setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
    getResponseHeader() { return null; }
    abort() { this.onabort?.(); }
    send(body: Blob) {
      sent.push({ url: this.url, headers: this.headers, body });
      setTimeout(() => this.upload.onprogress?.({ lengthComputable: true, loaded: body.size / 2, total: body.size }), 5);
      setTimeout(() => { const r = respond(body, this.headers); this.status = r.status; this.responseText = JSON.stringify(r.body); this.onload?.(); }, 30);
    }
  }
  vi.stubGlobal('XMLHttpRequest', X);
  return sent;
}

describe('Reiter Anhänge', () => {
  it('zeigt Liste mit Download, Vorschau nur für Rasterbilder, Löschen nur für Berechtigte', async () => {
    mockFetch({
      'GET /v1/me': () => json({ principal: ANNA }),
      [`GET /v1/objects/${OBJ}/attachments`]: () => json({ items: [att({ id: 'a1', name: 'foto.png', mediaType: 'image/png', preview: true }), att({ id: 'a2', name: 'vertrag.pdf', uploadedBy: CARLA })], nextCursor: null, total: 2 }),
    });
    renderWith(<AttachmentsPanel target={T} />, { me: WRITE, config: { link: u => `${u}?x-tenant=demo` } });
    const list = await screen.findByRole('list', { name: 'Anhänge' });
    const link = within(list).getByRole('link', { name: 'vertrag.pdf' });
    expect(link).toHaveAttribute('href', '/v1/attachments/a2/content?x-tenant=demo'); // Organisation des Tabs (Nr. 99, T1)
    expect(link).toHaveAttribute('download', 'vertrag.pdf');
    const thumbs = list.querySelectorAll('img');
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveAttribute('src', '/v1/attachments/a1/content?x-tenant=demo');
    await waitFor(() => expect(within(list).getByRole('button', { name: 'foto.png löschen' })).toBeInTheDocument());
    expect(within(list).queryByRole('button', { name: 'vertrag.pdf löschen' })).toBeNull();
    await userEvent.click(within(list).getByRole('button', { name: 'Vorschau von foto.png' }));
    const dlg = await screen.findByRole('dialog', { name: 'foto.png' });
    expect(within(dlg).getByRole('img', { name: 'Vorschau: foto.png' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lädt per Auswahl hoch, zeigt Fortschritt und aktualisiert die Liste', async () => {
    let items: unknown[] = [];
    mockFetch({ 'GET /v1/me': () => json({ principal: ANNA }), [`GET /v1/objects/${OBJ}/attachments`]: () => json({ items, nextCursor: null, total: items.length }) });
    const sent = fakeXhr(body => { items = [att({ id: 'n1', name: 'notiz.txt', size: body.size, mediaType: 'text/plain' })]; return { status: 201, body: items[0] }; });
    const { container } = renderWith(<AttachmentsPanel target={T} />, { me: WRITE });
    expect(await screen.findByText('Keine Anhänge')).toBeInTheDocument();
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['Grüezi'], 'notiz.txt', { type: 'text/plain' }));
    const bar = await screen.findByRole('progressbar', { name: /notiz\.txt/ });
    await waitFor(() => expect(bar).toHaveAttribute('aria-label', 'notiz.txt: 50 % hochgeladen'));
    expect(await screen.findByRole('link', { name: 'notiz.txt' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(sent[0]!.url).toContain(`/v1/objects/${OBJ}/attachments?name=notiz.txt`);
    expect(sent[0]!.headers['content-type']).toBe('text/plain');
    expect(sent[0]!.headers['x-csrf-token']).toBe('csrf-123');
  });

  it('Drag & Drop; Ablehnung des Servers wird beim Upload angezeigt', async () => {
    mockFetch({ 'GET /v1/me': () => json({ principal: ANNA }), [`GET /v1/objects/${OBJ}/attachments`]: () => json({ items: [], nextCursor: null, total: 0 }) });
    fakeXhr(() => ({ status: 422, body: { title: 'Inhalt passt nicht', status: 422, detail: 'Der Inhalt ist «text/html», angegeben war «image/png».' } }));
    const { container } = renderWith(<AttachmentsPanel target={T} />, { me: WRITE });
    await screen.findByText('Keine Anhänge');
    const zone = container.querySelector('.dropzone')!;
    const file = new File(['<html>'], 'bild.png', { type: 'image/png' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone).toHaveClass('over');
    await act(async () => { fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Der Inhalt ist «text/html», angegeben war «image/png».');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung zu bild.png schliessen' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Freigabe und Verbot je Bereich: Ablagefläche und Löschen nach den Fähigkeiten des Objekts', async () => {
    const items = [att({ id: 'a1', name: 'eigen.pdf' }), att({ id: 'a2', name: 'fremd.pdf', uploadedBy: CARLA })];
    mockFetch({ 'GET /v1/me': () => json({ principal: ANNA }), [`GET /v1/objects/${OBJ}/attachments`]: () => json({ items, nextCursor: null, total: 2 }) });
    // Rolle ohne attachment:write, aber Freigabe im Bereich: hochladen und eigene löschen, fremde nicht
    const { unmount } = renderWith(<AttachmentsPanel target={T} can={CAN({ attach: true }).can} />);
    expect(await screen.findByRole('button', { name: /Dateien auswählen/ })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Anhänge' });
    await waitFor(() => expect(within(list).getByRole('button', { name: 'eigen.pdf löschen' })).toBeInTheDocument());
    expect(within(list).queryByRole('button', { name: 'fremd.pdf löschen' })).toBeNull();
    unmount();
    // Rolle mit attachment:write, aber Verbot im Bereich: keine Ablagefläche, sondern der Grund
    renderWith(<AttachmentsPanel target={T} can={CAN({ deleteAttachments: true }).can} />, { me: WRITE });
    expect(await screen.findByText(/Hochladen nicht möglich: Für dieses Objekt ist der Zugriff eingeschränkt/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dateien auswählen/ })).toBeNull();
    const l2 = await screen.findByRole('list', { name: 'Anhänge' });
    expect(within(l2).getByRole('button', { name: 'fremd.pdf löschen' })).toBeInTheDocument();
  });

  it('ohne attachment:write keine Ablagefläche', async () => {
    mockFetch({ 'GET /v1/me': () => json({ principal: ANNA }), [`GET /v1/objects/${OBJ}/attachments`]: () => json({ items: [], nextCursor: null, total: 0 }) });
    renderWith(<AttachmentsPanel target={T} />);
    expect(await screen.findByText('Dateien zu diesem Objekt erscheinen hier.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dateien auswählen/ })).toBeNull();
  });
});
