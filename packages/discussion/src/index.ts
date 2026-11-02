/**
 * @vollholz/discussion – Kommentare, Anhänge und Benachrichtigungen an beliebigen Zielen einer App (Datenbank und API).
 *
 * Einbinden (README):
 * 1. Migration: `discussionMigrations({ schema, app, sched })` vor die Migrationen der App; in einer eigenen Migration
 *    `SELECT <schema>.discussion_targets('{"<typ>": "<schema>.<tabelle>"}')`.
 * 2. API: `app.register(discussion({ schema, host, targets, attachments }))`.
 * 3. Rechte `comment:write`, `comment:moderate`, `attachment:write`, `attachment:delete` den Rollen der App geben.
 * 4. Optional: weitere Arten für die Inbox anderer Bausteine mit `discussionInbox({ schema, kinds, subjects })`.
 */
export { discussion, DEFAULT_ALLOWED_TYPES, DEFAULT_MAX_BYTES, type AttachmentOptions, type DiscussionOptions } from './plugin.ts';
export { DiscussionError, DISCUSSION_PERMISSIONS, iamHost, permissionText, type DiscussionHost, type DiscussionPermission, type ProtocolEntry, type TargetRef, type Tx } from './host.ts';
export type { DiscussionNotice, DiscussionTarget, LoadedTarget, Notify } from './targets.ts';
export { COMMENT_KINDS, discussionInbox, type DiscussionInbox, type InboxNotice, type InboxOptions, type InboxSubject, type InboxSubjectRef, type InboxSubjectView } from './notifications.ts';
export { discussionMigrations, render, DISCUSSION_MIGRATIONS_DIR, type DiscussionMigration, type DiscussionMigrationOptions } from './migrations.ts';
export { purgeDeleted, purgeDeletedAttachments, rewrapAttachmentKeys, type Client } from './maintenance.ts';
export { box, keyById, primaryKey, unbox, validateKeyring, NoEncryptionKeyError, type Keyring, type MasterKey } from './crypto.ts';
export { BlobNotFound, blobKey, createBlobStore, FsBlobStore, S3BlobStore, signV4, type BlobEntry, type BlobStore, type S3Config } from './storage.ts';
export { ClamavScanner, createScanner, ScanError, type Scan, type ScanResult, type Scanner } from './scan.ts';
export { cleanName, contentDisposition, InvalidName } from './attachments.ts';
export { classify, detectType, PREVIEWABLE, SNIFF_BYTES } from './sniff.ts';
export { contentAad, dataKeyAad, openStream, SEGMENT, sealedLength, sealStream, unwrapKey } from './sealed-stream.ts';
export { commentExcerpt, BODY_MAX, MENTIONS_MAX } from './comments.ts';
