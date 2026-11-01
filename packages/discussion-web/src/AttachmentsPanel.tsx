/**
 * Anhänge an einem Ziel: Hochladen per Dateiauswahl oder Drag & Drop mit Fortschritt (einzeln
 * nacheinander, abbrechbar), Liste mit Download über die API, Vorschau nur für Rasterbilder (PNG, JPEG, GIF, WebP;
 * nie SVG oder HTML – der Server liefert ohnehin nur als Download mit CSP «sandbox»), Löschen mit Rückfrage.
 * Rechte am Ziel (`can.attach`, `can.deleteAttachments`: Rolle, Freigaben und Verbote je Bereich), wie die API sie
 * beim Speichern prüft; ohne `can` gilt das Recht auf Ebene der Organisation.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { contentUrl, dkKeys, uploadAttachment, useAttachments, useDeleteAttachment, type Attachment, type Target } from './api.ts';
import { allowed, type DiscussionCan } from './can.ts';
import { useDiscussion, useToaster } from './config.tsx';
import { fmtBytes, fmtDateTime, Icon, relTime } from './ui.tsx';

interface Upload { key: string; file: File; progress: number; state: 'waiting' | 'running' | 'failed'; error?: unknown; abort?: AbortController }

export function AttachmentsPanel({ target, can: caps }: { target: Target; can?: DiscussionCan }) {
  const d = useDiscussion();
  const q = useAttachments(target);
  const text = d.targets[target.type]!;
  const can = d.can;
  const { Loading, ErrorBox, Empty, Confirm, Modal, MissingRight } = d.ui;
  const my = d.me;
  const qc = useQueryClient();
  const toast = useToaster();
  const del = useDeleteAttachment(target);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [confirm, setConfirm] = useState<Attachment | null>(null);
  const [announce, setAnnounce] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const queue = useRef<Upload[]>([]);
  const hintId = useId();
  const write = allowed(d, caps, 'attach', 'attachment:write');
  const deleteOthers = allowed(d, caps, 'deleteAttachments', 'attachment:delete');

  const patch = (key: string, p: Partial<Upload> | null) => setUploads(list => (p === null ? list.filter(u => u.key !== key) : list.map(u => (u.key === key ? { ...u, ...p } : u))));

  // Nacheinander hochladen: übersichtlicher Fortschritt, keine Spitzen auf dem Server
  const pump = async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let u = queue.current.shift(); u; u = queue.current.shift()) {
        const abort = new AbortController();
        patch(u.key, { state: 'running', abort });
        setAnnounce(`${u.file.name} wird hochgeladen`);
        try {
          await uploadAttachment(d, target, u.file, { signal: abort.signal, onProgress: p => patch(u!.key, { progress: p }) });
          patch(u.key, null);
          setAnnounce('');
          toast.show(`${u.file.name} hochgeladen`); // Meldung als Toast (role=status), nicht doppelt ansagen
          await qc.invalidateQueries({ queryKey: dkKeys.attachments(target) });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') { patch(u.key, null); setAnnounce(`Hochladen von ${u.file.name} abgebrochen`); }
          else { patch(u.key, { state: 'failed', error: e }); setAnnounce(`${u.file.name} nicht hochgeladen`); }
        }
      }
    } finally { running.current = false; }
  };

  const add = (files: FileList | File[] | null) => {
    if (!files || !write) return;
    const items: Upload[] = [...files].map(file => ({ key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, progress: 0, state: 'waiting' }));
    if (!items.length) return;
    setUploads(list => [...list, ...items]);
    queue.current.push(...items);
    void pump();
  };

  const items = q.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <div className="discussion">
      {write ? (
        // Ablagefläche für die Maus; per Tastatur über den Knopf «Dateien auswählen»
        <div className={`dropzone${drag ? ' over' : ''}`} aria-describedby={hintId}
          onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
          onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
          <Icon name="upload" />
          <div>
            <button type="button" className="dk-btn sm" onClick={() => input.current?.click()}><Icon name="clip" />Dateien auswählen</button>
            <span className="dk-muted dk-small"> oder hierher ziehen</span>
          </div>
          <div id={hintId} className="dk-muted dk-small">Bilder, PDF, Text, CSV, Office-Dokumente und ZIP. Der Typ wird am Inhalt geprüft.</div>
          <input ref={input} type="file" multiple hidden aria-label="Dateien zum Hochladen" onChange={e => { add(e.target.files); e.target.value = ''; }} />
        </div>
      ) : can('attachment:write') ? <p className="dk-muted dk-small dk-missing">Hochladen nicht möglich: {text.restricted} ist der Zugriff eingeschränkt. Fragen dazu beantwortet die Organisations-Administration.</p>
        : <MissingRight perm="attachment:write" lead="Zum Hochladen" />}
      <div role="status" aria-live="polite" className="dk-sr">{announce}</div>
      {uploads.length ? (
        <ul className="up-list" aria-label="Uploads">
          {uploads.map(u => (
            <li key={u.key} className={`up ${u.state}`}>
              <div className="up-row">
                <Icon name="doc" /><span className="up-name">{u.file.name}</span><span className="dk-muted dk-small">{fmtBytes(u.file.size)}</span>
                <span className="dk-spacer" />
                {u.state === 'failed'
                  ? <button type="button" className="dk-btn sm ghost" onClick={() => patch(u.key, null)} aria-label={`Meldung zu ${u.file.name} schliessen`}><Icon name="x" /></button>
                  : <button type="button" className="dk-btn sm ghost" onClick={() => { if (u.state === 'running') u.abort?.abort(); else { queue.current = queue.current.filter(x => x.key !== u.key); patch(u.key, null); } }}>Abbrechen</button>}
              </div>
              {u.state === 'failed' ? <ErrorBox error={u.error} compact /> : (
                <progress max={1} value={u.state === 'waiting' ? 0 : u.progress} aria-label={`${u.file.name}: ${u.state === 'waiting' ? 'wartet' : `${Math.round(u.progress * 100)} % hochgeladen`}`} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {q.isPending ? <Loading label="Anhänge werden geladen …" /> : q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : items.length ? (
        <ul className="att-list" aria-label="Anhänge">
          {items.map(a => {
            const canDelete = (my === a.uploadedBy?.id && write) || deleteOthers;
            return (
              <li key={a.id} className="att">
                {a.preview ? (
                  <button type="button" className="att-thumb" onClick={() => setPreview(a)} aria-label={`Vorschau von ${a.name}`}>
                    <img src={contentUrl(d, a.id)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  </button>
                ) : <span className="att-thumb icon" aria-hidden="true"><Icon name={a.mediaType.startsWith('image/') ? 'image' : 'doc'} /></span>}
                <div className="att-main">
                  <a href={contentUrl(d, a.id)} download={a.name} className="att-name">{a.name}</a>
                  <div className="dk-muted dk-small">
                    {fmtBytes(a.size)} · {a.uploadedBy?.name ?? 'Unbekannt'} · <time dateTime={String(a.uploadedAt)} title={fmtDateTime(a.uploadedAt)}>{relTime(a.uploadedAt)}</time>
                  </div>
                </div>
                <a className="dk-btn sm ghost" href={contentUrl(d, a.id)} download={a.name} aria-label={`${a.name} herunterladen`}><Icon name="download" /></a>
                {canDelete ? <button type="button" className="dk-btn sm ghost" onClick={() => setConfirm(a)} aria-label={`${a.name} löschen`}><Icon name="trash" /></button> : null}
              </li>
            );
          })}
        </ul>
      ) : <Empty icon="clip" title="Keine Anhänge">{write ? `${text.files ?? 'Dateien'} ${text.here} hier ablegen.` : `Dateien ${text.here} erscheinen hier.`}</Empty>}
      {q.hasNextPage ? <button type="button" className="dk-btn sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Lädt …' : 'Weitere Anhänge laden'}</button> : null}
      {preview ? (
        <Modal title={preview.name} onClose={() => setPreview(null)} width={720}
          footer={<><a className="dk-btn" href={contentUrl(d, preview.id)} download={preview.name}><Icon name="download" />Herunterladen</a><button type="button" className="dk-btn primary" onClick={() => setPreview(null)}>Schliessen</button></>}>
          <img className="att-preview" src={contentUrl(d, preview.id)} alt={`Vorschau: ${preview.name}`} referrerPolicy="no-referrer" />
        </Modal>
      ) : null}
      {confirm ? (
        <Confirm title={`«${confirm.name}» löschen?`} confirm="Löschen" danger busy={del.isPending} onClose={() => setConfirm(null)}
          onConfirm={() => del.mutate(confirm.id, { onSuccess: () => { toast.show(`${confirm.name} gelöscht`); setConfirm(null); }, onError: e => { toast.error(e, 'Nicht gelöscht'); setConfirm(null); } })}>
          <p>Der Anhang verschwindet sofort; die Datei wird nach Ablauf der Aufbewahrungsfrist endgültig entfernt.</p>
        </Confirm>
      ) : null}
    </div>
  );
}
