/**
 * Viren-Scan beim Hochladen (Hook). `ATTACHMENT_SCAN=clamav` schickt den Klartext während des Uploads parallel an
 * clamd (Protokoll INSTREAM über TCP, `CLAMAV_ADDRESS`); gespeichert wird der Anhang erst nach dem Ergebnis «OK».
 * Fund oder Fehler des Scanners lehnen den Upload ab (lieber abweisen als ungeprüft speichern).
 */
import { connect, type Socket } from 'node:net';
import { Transform, type TransformCallback } from 'node:stream';

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface Scan {
  /** Durchreichender Strom; jeder Block geht zusätzlich an den Scanner. */
  readonly tap: Transform;
  /** Ergebnis nach Ende des Stroms. */
  result(): Promise<ScanResult>;
  abort(): void;
}

export interface Scanner { start(): Scan }

export class ScanError extends Error {}

const CHUNK = 64 * 1024;

export class ClamavScanner implements Scanner {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  constructor(address: string, timeoutMs = 60_000) {
    const i = address.lastIndexOf(':');
    this.host = address.slice(0, i); this.port = Number(address.slice(i + 1)); this.timeoutMs = timeoutMs;
  }

  start(): Scan {
    const sock: Socket = connect({ host: this.host, port: this.port });
    sock.setTimeout(this.timeoutMs, () => sock.destroy(new ScanError('Viren-Scan: Zeitüberschreitung')));
    let reply = '', failed: Error | null = null;
    const done = new Promise<ScanResult>((ok, fail) => {
      sock.on('data', d => { reply += d.toString('utf8'); });
      sock.on('error', e => { failed = e instanceof ScanError ? e : new ScanError(`Viren-Scan nicht erreichbar: ${e.message}`); fail(failed); });
      sock.on('close', () => {
        if (failed) return;
        const r = reply.replace(/\0/g, '').trim();
        const m = /^stream: (.+) FOUND$/.exec(r);
        if (r === 'stream: OK') ok({ clean: true });
        else if (m) ok({ clean: false, signature: m[1]! });
        else fail(new ScanError(`Viren-Scan: unerwartete Antwort «${r.slice(0, 200)}»`));
      });
    });
    done.catch(() => undefined);
    sock.write('zINSTREAM\0');
    const send = (b: Buffer, cb: (e?: Error | null) => void) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(b.length);
      sock.write(Buffer.concat([len, b]), cb);
    };
    const tap = new Transform({
      transform(chunk: Buffer, _e, cb: TransformCallback) {
        if (failed) return cb(failed);
        // Grosse Blöcke aufteilen (clamd: StreamMaxLength gilt gesamt, Blöcke dürfen beliebig klein sein)
        const parts: Buffer[] = [];
        for (let i = 0; i < chunk.length; i += CHUNK) parts.push(chunk.subarray(i, i + CHUNK));
        const next = (i: number) => { if (i >= parts.length) return cb(null, chunk); send(parts[i]!, e => (e ? cb(failed ?? new ScanError(`Viren-Scan nicht erreichbar: ${e.message}`)) : next(i + 1))); };
        next(0);
      },
      flush(cb: TransformCallback) {
        if (failed) return cb(failed);
        sock.end(Buffer.alloc(4));
        cb();
      },
    });
    return { tap, result: () => done, abort: () => sock.destroy() };
  }
}

/** Scanner aus der Konfiguration der App: `clamav` mit Adresse, sonst keiner. */
export function createScanner(cfg: { scan: 'off' | 'clamav'; clamavAddress: string | null }): Scanner | null {
  return cfg.scan === 'clamav' && cfg.clamavAddress ? new ClamavScanner(cfg.clamavAddress) : null;
}
