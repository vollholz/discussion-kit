/**
 * MIME-Typ eines Anhangs am Inhalt erkennen (die Angabe des Browsers und die Dateiendung sind nur Hinweise).
 *
 * Erkannt werden die üblichen Bild-, PDF-, ZIP- und Office-Formate über Signaturen, Text über gültiges UTF-8 ohne
 * NUL. Text, der wie HTML, SVG oder XML beginnt, gilt als solches – damit kann eine HTML-Datei nicht als «text/plain»
 * oder «image/png» durchrutschen. Innerhalb von Text verfeinern Angabe bzw. Endung den Typ (CSV, Markdown).
 */

export const SNIFF_BYTES = 64 * 1024;

const OOXML: Record<string, string> = {
  'word/': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xl/': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt/': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Typen je Dateiendung, für den Abgleich Endung ↔ Inhalt. */
const BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', log: 'text/plain', csv: 'text/csv', md: 'text/markdown', markdown: 'text/markdown',
  json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html', xhtml: 'text/html', js: 'text/javascript', mjs: 'text/javascript',
  docx: OOXML['word/']!, xlsx: OOXML['xl/']!, pptx: OOXML['ppt/']!, exe: 'application/x-msdownload', dll: 'application/x-msdownload',
};

const TEXT_REFINE = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);
const starts = (b: Buffer, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

function isUtf8Text(b: Buffer, complete: boolean): boolean {
  if (b.includes(0)) return false;
  // Ein am Ende abgeschnittenes Mehrbytezeichen ist kein Fehler, wenn nur der Anfang vorliegt
  let end = b.length;
  if (!complete) { let i = end - 1, k = 0; while (i >= 0 && k < 3 && (b[i]! & 0xc0) === 0x80) { i--; k++; } if (i >= 0 && b[i]! >= 0xc0) end = i; }
  try { new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, end)); return true; } catch { return false; }
}

/** Typ nur aus dem Inhalt (Anfang der Datei). */
export function detectType(head: Buffer, complete: boolean): string {
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (head.subarray(0, 6).toString('latin1') === 'GIF87a' || head.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (starts(head, [0x50, 0x4b, 0x03, 0x04]) || starts(head, [0x50, 0x4b, 0x05, 0x06])) {
    const s = head.toString('latin1');
    if (s.includes('[Content_Types].xml')) for (const [dir, type] of Object.entries(OOXML)) if (s.includes(dir)) return type;
    return 'application/zip';
  }
  if (starts(head, [0x4d, 0x5a])) return 'application/x-msdownload';
  if (head.length === 0) return 'text/plain';
  if (isUtf8Text(head, complete)) {
    const t = head.toString('utf8').replace(/^﻿/, '').trimStart().slice(0, 1024).toLowerCase();
    if (/^<(!doctype\s+html|html|head|body|script|iframe|meta|link|style|title|!--)/.test(t)) return 'text/html';
    if (t.startsWith('<svg') || (t.startsWith('<?xml') && t.includes('<svg'))) return 'image/svg+xml';
    if (t.startsWith('<?xml')) return 'application/xml';
    return 'text/plain';
  }
  return 'application/octet-stream';
}

export const extensionOf = (name: string) => /\.([a-z0-9]{1,10})$/i.exec(name)?.[1]?.toLowerCase() ?? null;

const family = (t: string) => (TEXT_REFINE.has(t) ? 'text' : t.startsWith('image/') && t !== 'image/svg+xml' ? 'image' : t);
const generic = (t: string | null | undefined) => !t || t === 'application/octet-stream' || t === 'binary/octet-stream';

export type Verdict = { ok: true; type: string } | { ok: false; reason: string };

/**
 * Endgültiger Typ eines Uploads: erkannter Typ, bei Text verfeinert. Abgelehnt wird, wenn die Angabe des Browsers
 * oder die Dateiendung zu einer anderen Art von Inhalt gehört (manipulierter Typ), oder der Typ nicht erlaubt ist.
 */
export function classify(o: { head: Buffer; complete: boolean; declared: string | null; name: string; allowed: string[] }): Verdict {
  const detected = detectType(o.head, o.complete);
  const declared = generic(o.declared) ? null : o.declared!.split(';')[0]!.trim().toLowerCase();
  const ext = extensionOf(o.name), extType = ext ? BY_EXT[ext] ?? null : null;
  let type = detected;
  if (detected === 'text/plain') {
    const hint = [declared, extType].find(t => t && TEXT_REFINE.has(t));
    if (hint) type = hint;
  }
  if (declared && family(declared) !== family(type) && !(declared === 'application/x-zip-compressed' && type === 'application/zip')) {
    return { ok: false, reason: `Der Inhalt ist «${type}», angegeben war «${declared}».` };
  }
  if (extType && family(extType) !== family(type)) return { ok: false, reason: `Die Endung «.${ext}» passt nicht zum Inhalt («${type}»).` };
  if (!o.allowed.includes(type)) return { ok: false, reason: `Dateityp «${type}» ist nicht erlaubt. Erlaubt: ${o.allowed.join(', ')}.` };
  return { ok: true, type };
}

/** Bilder, die die Oberfläche als Vorschau zeigen darf (kein SVG: kann Skripte enthalten). */
export const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
