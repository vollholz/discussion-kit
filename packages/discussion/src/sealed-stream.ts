/**
 * Verschlüsselung von Dateiinhalten als Strom (Anhänge), AES-256-GCM in Segmenten (STREAM-Konstruktion).
 *
 * crypto.ts verschlüsselt ganze Puffer; Anhänge sind bis zu ATTACHMENT_MAX_BYTES gross und sollen weder beim
 * Hochladen noch beim Herunterladen ganz im Speicher liegen. Darum:
 * - je Datei ein zufälliger Datenschlüssel, umschlossen mit dem Hauptschlüssel (crypto.ts `box`, AAD bindet an
 *   Mandant und Anhang; Rotation schliesst nur den Datenschlüssel neu ein),
 * - Inhalt in Segmenten zu 64 KiB, jedes mit eigenem Tag. Nonce = Präfix (7 Bytes, zufällig je Datei) | Segmentnummer
 *   (4 Bytes) | Endkennzeichen (1 Byte). Vertauschen, Weglassen oder Abschneiden von Segmenten fällt auf.
 * - Beim Herunterladen wird jedes Segment erst nach geprüftem Tag ausgegeben: nie ungeprüfter Klartext.
 *
 * Format: Version (1 Byte = 1) | Präfix (7) | Segmente (Chiffrat | Tag 16). Länge = 8 + Grösse + 16 · Segmente.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { box, keyById, newDataKey, primaryKey, unbox, type Keyring } from './crypto.ts';

export const SEGMENT = 64 * 1024;
const HEADER = 8, TAG = 16, VERSION = 1;

/** Anzahl Segmente (mindestens eines, auch bei leerer Datei). */
export const segments = (size: number) => Math.max(1, Math.ceil(size / SEGMENT));
export const sealedLength = (size: number) => HEADER + size + TAG * segments(size);

const nonce = (prefix: Buffer, i: number, last: boolean) => {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0, 0, 7);
  n.writeUInt32BE(i, 7);
  n[11] = last ? 1 : 0;
  return n;
};

export const dataKeyAad = (tenantId: string, attachmentId: string) => `attachment-key:${tenantId}:${attachmentId}`;
export const contentAad = (tenantId: string, attachmentId: string) => `attachment:${tenantId}:${attachmentId}`;

/** Neuer Datenschlüssel, umschlossen mit dem ersten Hauptschlüssel. */
export function newWrappedKey(keys: Keyring, tenantId: string, attachmentId: string) {
  const master = primaryKey(keys);
  const key = newDataKey();
  return { key, keyId: master.id, wrapped: box(master.key, key, dataKeyAad(tenantId, attachmentId)) };
}

export function unwrapKey(keys: Keyring, keyId: string, wrapped: Buffer, tenantId: string, attachmentId: string): Buffer {
  return unbox(keyById(keys, keyId).key, wrapped, dataKeyAad(tenantId, attachmentId));
}

/**
 * Verschlüsselt einen Strom bekannter Länge `size`. Weicht die tatsächliche Länge ab, endet der Strom mit Fehler
 * (`LengthMismatch`), damit keine abgeschnittene oder verlängerte Datei gespeichert wird.
 */
export function sealStream(key: Buffer, aad: string, size: number): Transform {
  const prefix = randomBytes(7), total = segments(size), aadBuf = Buffer.from(aad, 'utf8');
  let buf: Buffer[] = [], buffered = 0, index = 0, seen = 0, headerSent = false;
  const seal = (t: Transform, plain: Buffer) => {
    const last = index === total - 1;
    const c = createCipheriv('aes-256-gcm', key, nonce(prefix, index, last));
    c.setAAD(aadBuf);
    if (!headerSent) { t.push(Buffer.concat([Buffer.from([VERSION]), prefix])); headerSent = true; }
    t.push(Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]));
    index++;
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      seen += chunk.length;
      if (seen > size) return cb(new LengthMismatch(size, seen));
      buf.push(chunk); buffered += chunk.length;
      // Volle Segmente sofort verschlüsseln; das letzte (evtl. volle) erst bei bekanntem Ende
      while (buffered > SEGMENT || (buffered === SEGMENT && index < total - 1)) {
        const all = Buffer.concat(buf);
        seal(this, all.subarray(0, SEGMENT));
        buf = [all.subarray(SEGMENT)]; buffered -= SEGMENT;
      }
      cb();
    },
    flush(cb: TransformCallback) {
      if (seen !== size) return cb(new LengthMismatch(size, seen));
      seal(this, Buffer.concat(buf));
      buf = [];
      cb();
    },
  });
}

/** Entschlüsselt einen mit `sealStream` erzeugten Strom; `size` ist die Klartextgrösse aus den Metadaten. */
export function openStream(key: Buffer, aad: string, size: number): Transform {
  const total = segments(size), aadBuf = Buffer.from(aad, 'utf8');
  let buf: Buffer = Buffer.alloc(0), prefix: Buffer | null = null, index = 0, done = false;
  const segLen = (i: number) => (i === total - 1 ? size - SEGMENT * (total - 1) : SEGMENT) + TAG;
  const open = (t: Transform) => {
    while (!done) {
      if (!prefix) {
        if (buf.length < HEADER) return;
        if (buf[0] !== VERSION) throw new Error('Unbekanntes Format der verschlüsselten Datei');
        prefix = buf.subarray(1, HEADER); buf = buf.subarray(HEADER);
      }
      const need = segLen(index);
      if (buf.length < need) return;
      const last = index === total - 1;
      const d = createDecipheriv('aes-256-gcm', key, nonce(prefix, index, last));
      d.setAAD(aadBuf);
      d.setAuthTag(buf.subarray(need - TAG, need));
      t.push(Buffer.concat([d.update(buf.subarray(0, need - TAG)), d.final()]));
      buf = buf.subarray(need); index++;
      if (last) done = true;
    }
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (done) return cb(new Error('Daten nach dem letzten Segment'));
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      try { open(this); cb(); } catch (e) { cb(e as Error); }
    },
    flush(cb: TransformCallback) {
      cb(done && !buf.length ? undefined : new Error('Verschlüsselte Datei unvollständig'));
    },
  });
}

export class LengthMismatch extends Error {
  readonly expected: number; readonly actual: number;
  constructor(expected: number, actual: number) { super(`Länge ${actual} statt ${expected} Bytes`); this.expected = expected; this.actual = actual; }
}
