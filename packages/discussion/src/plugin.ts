/**
 * Fastify-Plugin des Baukastens: Kommentare, Anhänge und Benachrichtigungen an den Zielen der App.
 *
 * ```ts
 * await app.register(discussion({
 *   schema: 'myapp',
 *   host: iamHost({ HttpError }),
 *   targets: [orderTarget],
 *   attachments: { store: createBlobStore(cfg), keys: cfg.encryptionKeys },
 * }));
 * ```
 */
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { registerAttachments } from './attachments.ts';
import { commentExcerpt, registerComments } from './comments.ts';
import type { Keyring } from './crypto.ts';
import { hostKit, type DiscussionHost, type HostKit } from './host.ts';
import { ident } from './http.ts';
import { inboxNotify, registerNotifications } from './notifications.ts';
import type { Scanner } from './scan.ts';
import type { BlobStore } from './storage.ts';
import { Targets, type DiscussionTarget, type Notify } from './targets.ts';

/** Typen, die der Inhaltsprüfung nach als Anhang erlaubt sind (Standard). */
export const DEFAULT_ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
/** Höchste Grösse eines Anhangs (Standard 25 MiB). */
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export interface AttachmentOptions {
  /** Ablage der verschlüsselten Dateien (`FsBlobStore`, `S3BlobStore` oder `createBlobStore`). */
  store: BlobStore;
  /** Hauptschlüssel; der erste verschlüsselt. Ohne Schlüssel antwortet der Upload mit 503. */
  keys: Keyring;
  maxBytes?: number;
  allowedTypes?: string[];
  /** Viren-Scan (`ClamavScanner`, `createScanner`); Standard: keiner. */
  scanner?: Scanner | null;
}

export interface DiscussionOptions {
  /** Schema der Tabellen (wie in `discussionMigrations`); dort liegt auch das Personenverzeichnis `principal`. */
  schema: string;
  host: DiscussionHost;
  targets: DiscussionTarget[];
  /** Anhänge; ohne diese Angabe gibt es keine Routen für Anhänge. */
  attachments?: AttachmentOptions;
  /**
   * Benachrichtigungen: Standard die Inbox des Pakets (`/v1/me/notifications`). Eigene Funktion = Einträge gehen an die
   * App (keine Routen der Inbox); `false` = keine Benachrichtigungen.
   */
  notifications?: Notify | false;
}

/** Was die Routen brauchen (intern). */
export interface Ctx {
  app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>; // eslint-disable-line @typescript-eslint/no-explicit-any
  k: HostKit;
  host: DiscussionHost;
  targets: Targets;
  schema: string;
  notify?: Notify;
  attachments?: Required<Omit<AttachmentOptions, 'store'>> & { blobs: BlobStore };
}

export function discussion(o: DiscussionOptions): FastifyPluginAsync {
  const schema = ident(o.schema, 'schema');
  const targets = new Targets(o.targets);
  const notify = o.notifications === false ? undefined : o.notifications ?? inboxNotify(schema);
  return async instance => {
    const c: Ctx = {
      app: instance.withTypeProvider<TypeBoxTypeProvider>(), k: hostKit(o.host), host: o.host, targets, schema, notify,
      ...(o.attachments ? {
        attachments: {
          blobs: o.attachments.store, keys: o.attachments.keys, scanner: o.attachments.scanner ?? null,
          maxBytes: o.attachments.maxBytes ?? DEFAULT_MAX_BYTES, allowedTypes: o.attachments.allowedTypes ?? DEFAULT_ALLOWED_TYPES,
        },
      } : {}),
    };
    registerComments(c);
    if (c.attachments) registerAttachments(c);
    if (o.notifications === undefined) registerNotifications(c, commentExcerpt(schema));
  };
}
