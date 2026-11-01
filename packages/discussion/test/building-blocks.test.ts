/** Bausteine der Anhänge: Verschlüsselung in Segmenten, Typerkennung, Dateinamen, S3-Signatur und -Ablage. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';
import { classify, cleanName, contentDisposition, detectType, openStream, S3BlobStore, SEGMENT, sealedLength, sealStream, signV4 } from '../src/index.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDR-Testbild-'), randomBytes(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
const HTML = Buffer.from('<!DOCTYPE html><html><script>alert(document.cookie)</script></html>');
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const EXE = Buffer.concat([Buffer.from('MZ'), randomBytes(64)]);

async function collect(s: Readable): Promise<Buffer> { const parts: Buffer[] = []; for await (const c of s) parts.push(c as Buffer); return Buffer.concat(parts); }
async function seal(plain: Buffer, key: Buffer, aad: string) { return collect(Readable.from([plain]).pipe(sealStream(key, aad, plain.length))); }
async function unseal(sealed: Buffer, key: Buffer, aad: string, size: number) { return collect(Readable.from([sealed]).pipe(openStream(key, aad, size))); }

describe('Anhänge: Bausteine', () => {
  test('Verschlüsselung in Segmenten: Rundlauf für alle Grenzfälle, Länge wie berechnet', async () => {
    const key = randomBytes(32);
    for (const n of [0, 1, SEGMENT - 1, SEGMENT, SEGMENT + 1, 2 * SEGMENT, 3 * SEGMENT + 17]) {
      const plain = randomBytes(n);
      // in ungleichen Stücken einspeisen
      const chunks: Buffer[] = []; for (let i = 0; i < n; i += 7777) chunks.push(plain.subarray(i, i + 7777));
      const sealed = await collect(Readable.from(chunks.length ? chunks : [Buffer.alloc(0)]).pipe(sealStream(key, 'a', n)));
      assert.equal(sealed.length, sealedLength(n), `Länge bei ${n}`);
      assert.ok(n < 32 || !sealed.includes(plain.subarray(0, 32)), 'kein Klartext im Chiffrat');
      assert.deepEqual(await unseal(sealed, key, 'a', n), plain, `Rundlauf bei ${n}`);
    }
  });

  test('Verschlüsselung erkennt Manipulation, Abschneiden, Vertauschen, falsche Zuordnung und falsche Länge', async () => {
    const key = randomBytes(32), plain = randomBytes(2 * SEGMENT + 100);
    const sealed = await seal(plain, key, 'a');
    const flipped = Buffer.from(sealed); flipped[SEGMENT + 500]! ^= 1;
    await assert.rejects(unseal(flipped, key, 'a', plain.length), /auth|Unsupported state/i);
    await assert.rejects(unseal(sealed.subarray(0, sealed.length - 1), key, 'a', plain.length), /unvollständig|auth|Unsupported/i);
    const seg = SEGMENT + 16, h = 8;
    const swapped = Buffer.concat([sealed.subarray(0, h), sealed.subarray(h + seg, h + 2 * seg), sealed.subarray(h, h + seg), sealed.subarray(h + 2 * seg)]);
    await assert.rejects(unseal(swapped, key, 'a', plain.length), /auth|Unsupported/i, 'Segmente vertauscht');
    await assert.rejects(unseal(sealed, key, 'anderer-anhang', plain.length), /auth|Unsupported/i, 'AAD bindet an den Anhang');
    // Kürzere Datei als Länge vorgegeben: letztes Segment fehlt das Endkennzeichen
    await assert.rejects(unseal(sealed.subarray(0, h + seg), key, 'a', SEGMENT), /auth|Unsupported/i, 'abgeschnitten nach vollem Segment');
    await assert.rejects(collect(Readable.from([randomBytes(10)]).pipe(sealStream(key, 'a', 11))), /Länge 10 statt 11/);
    await assert.rejects(collect(Readable.from([randomBytes(12)]).pipe(sealStream(key, 'a', 11))), /Länge 12 statt 11/);
  });

  test('Typerkennung am Inhalt; manipulierte Angaben und Endungen werden abgelehnt', () => {
    const allowed = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'text/csv', 'application/zip'];
    const c = (head: Buffer, declared: string | null, name: string) => classify({ head, complete: true, declared, name, allowed });
    assert.equal(detectType(PNG, true), 'image/png');
    assert.equal(detectType(HTML, true), 'text/html');
    assert.equal(detectType(Buffer.from('  \n<HTML><body>x'), true), 'text/html');
    assert.equal(detectType(SVG, true), 'image/svg+xml');
    assert.equal(detectType(Buffer.from([0xef, 0xbb, 0xbf, 0x3c, 0x73, 0x76, 0x67, 0x3e]), true), 'image/svg+xml', 'mit BOM');
    assert.equal(detectType(Buffer.from('Grüezi\nmitenand'), true), 'text/plain');
    assert.equal(detectType(Buffer.from([0xc3]), false), 'text/plain', 'abgeschnittenes UTF-8-Zeichen am Ende des Anfangs');
    assert.equal(detectType(Buffer.from([0x00, 0x01, 0x02]), true), 'application/octet-stream');
    assert.deepEqual(c(PNG, 'image/png', 'bild.png'), { ok: true, type: 'image/png' });
    assert.deepEqual(c(JPEG, 'image/png', 'bild.png'), { ok: true, type: 'image/jpeg' }, 'Bild bleibt Bild, Typ vom Inhalt');
    assert.deepEqual(c(Buffer.from('a;b\n1;2\n'), 'text/csv', 'liste.csv'), { ok: true, type: 'text/csv' });
    assert.deepEqual(c(Buffer.from('a;b\n1;2\n'), null, 'liste.csv'), { ok: true, type: 'text/csv' }, 'Endung verfeinert Text');
    assert.equal(c(HTML, 'image/png', 'bild.png').ok, false, 'HTML als PNG ausgegeben');
    assert.equal(c(HTML, 'text/plain', 'notiz.txt').ok, false, 'HTML als Text ausgegeben');
    assert.match((c(HTML, null, 'x.bin') as { reason: string }).reason, /nicht erlaubt/);
    assert.equal(c(PNG, 'image/png', 'bild.html').ok, false, 'gefährliche Endung');
    assert.equal(c(EXE, 'application/pdf', 'rechnung.pdf').ok, false, 'Programm als PDF');
    assert.match((c(SVG, 'image/svg+xml', 'logo.svg') as { reason: string }).reason, /nicht erlaubt/);
  });

  test('Dateinamen und Content-Disposition', () => {
    assert.equal(cleanName('C:\\Users\\x\\Bericht.pdf'), 'Bericht.pdf');
    assert.equal(cleanName('../../etc/passwd'), 'passwd');
    assert.equal(cleanName('a\u0000b\nc.txt'), 'abc.txt');
    assert.throws(() => cleanName('../'), /Dateiname/);
    assert.equal(contentDisposition('Prüfbericht "Q1".pdf'), `attachment; filename="Pru_fbericht _Q1_.pdf"; filename*=UTF-8''Pr%C3%BCfbericht%20%22Q1%22.pdf`);
  });

  test('S3-Signatur (AWS Signature Version 4) wie im Beispiel der AWS-Dokumentation', () => {
    // «Example: GET Object» aus der S3-Dokumentation (Signature Version 4, Header-Variante)
    const auth = signV4({
      method: 'GET', path: '/test.txt', payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
    });
    assert.equal(auth, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  test('S3-Ablage: PUT mit Länge, GET, DELETE gegen nachgebildeten Speicher', async () => {
    const objects = new Map<string, Buffer>(), seen: { method: string; url: string; auth: string; length?: string }[] = [];
    const s3: Server = createHttpServer((req, res) => {
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), length: req.headers['content-length'] });
      if (!/^AWS4-HMAC-SHA256 Credential=ak\/\d{8}\/eu-central-2\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/.test(String(req.headers.authorization))) { res.statusCode = 403; return res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>'); }
      if (req.method === 'PUT') { const parts: Buffer[] = []; req.on('data', c => parts.push(c)); req.on('end', () => { objects.set(req.url!, Buffer.concat(parts)); res.end(); }); return; }
      if (req.method === 'GET') { const b = objects.get(req.url!); if (!b) { res.statusCode = 404; return res.end('<Error><Code>NoSuchKey</Code></Error>'); } return res.end(b); }
      if (req.method === 'DELETE') { objects.delete(req.url!); res.statusCode = 204; return res.end(); }
      res.statusCode = 405; res.end();
    });
    await new Promise<void>(r => s3.listen(0, '127.0.0.1', r));
    try {
      const store = new S3BlobStore({ endpoint: `http://127.0.0.1:${(s3.address() as AddressInfo).port}`, bucket: 'anhaenge', region: 'eu-central-2', prefix: 'assets/', pathStyle: true, accessKeyId: 'ak', secretAccessKey: 'geheim' });
      const key = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222', body = randomBytes(100_000);
      await store.put(key, Readable.from([body.subarray(0, 50_000), body.subarray(50_000)]), body.length);
      assert.equal(seen[0]!.url, `/anhaenge/assets/${key}`);
      assert.equal(seen[0]!.length, '100000');
      assert.deepEqual(await collect(await store.get(key)), body);
      await store.delete(key);
      await assert.rejects(store.get(key), /BlobNotFound|2222/);
      await store.delete(key);
      const bad = new S3BlobStore({ endpoint: `http://127.0.0.1:${(s3.address() as AddressInfo).port}`, bucket: 'anhaenge', region: 'eu-central-2', prefix: '', pathStyle: true, accessKeyId: 'falsch', secretAccessKey: 'x' });
      await assert.rejects(bad.put(key, Readable.from([body]), body.length), /S3 Speichern: HTTP 403 SignatureDoesNotMatch/);
      await assert.rejects(store.put('../x', Readable.from([body]), body.length), /Ungültiger Ablageschlüssel/);
    } finally { s3.closeAllConnections(); await new Promise(r => s3.close(r)); }
  });
});
