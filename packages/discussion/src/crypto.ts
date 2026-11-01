/**
 * Verschlüsselung der Anhänge: AES-256-GCM mit den Hauptschlüsseln der App (bei Apps mit `@vollholz/iam` dieselben
 * ENCRYPTION_KEYS). Der erste Schlüssel verschlüsselt, alle entschlüsseln (Rotation: neuen Schlüssel vorne, dann
 * `rewrapAttachmentKeys`, danach den alten entfernen). `box`/`unbox`: Rohformat `IV (12) | Tag (16) | Chiffrat`,
 * bytegleich mit `@vollholz/iam`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface MasterKey { id: string; key: Buffer }
export type Keyring = readonly MasterKey[];

const IV = 12, TAG = 16;

/** Fehlt ENCRYPTION_KEYS, wenn etwas verschlüsselt werden soll. Module übersetzen ihn in ihre Fehlermeldung. */
export class NoEncryptionKeyError extends Error {
  constructor() { super('ENCRYPTION_KEYS ist nicht gesetzt'); }
}

export function primaryKey(keys: Keyring): MasterKey {
  const k = keys[0];
  if (!k) throw new NoEncryptionKeyError();
  return k;
}

export function keyById(keys: Keyring, id: string): MasterKey {
  const k = keys.find(x => x.id === id);
  if (!k) throw new Error(`Hauptschlüssel «${id}» fehlt in ENCRYPTION_KEYS`);
  return k;
}

export function validateKeyring(keys: Keyring) {
  for (const k of keys) {
    if (k.key.length !== 32) throw new Error(`Schlüssel ${k.id} muss 32 Bytes haben`);
    if (!k.id || Buffer.byteLength(k.id) > 255 || k.id.includes('.')) throw new Error('Schlüssel-ID: 1–255 Bytes, ohne Punkt');
  }
}

/** Verschlüsselt mit einem konkreten Schlüssel (Haupt- oder Datenschlüssel). Ergebnis: IV | Tag | Chiffrat. */
export function box(key: Buffer, plain: string | Buffer, aad: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

/** Gegenstück zu `box`; wirft bei falschem Schlüssel, falscher AAD oder Manipulation. */
export function unbox(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < IV + TAG) throw new Error('Chiffrat zu kurz');
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(sealed.subarray(IV, IV + TAG));
  return Buffer.concat([d.update(sealed.subarray(IV + TAG)), d.final()]);
}

/** Zufälliger 256-Bit-Datenschlüssel für Umschlagverschlüsselung. */
export const newDataKey = () => randomBytes(32);
