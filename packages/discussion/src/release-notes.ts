/**
 * Release Notes der Pakete des Kits für die Release Notes einer App.
 *
 * Jedes Paket führt `CHANGELOG.md` nach «Keep a Changelog»; jeder Versionsabschnitt beginnt mit zwei Unterabschnitten,
 * die eine App unverändert übernehmen kann:
 *
 *   ## [1.0.1] – 2026-11-01
 *   ### Für Nutzer          allgemein verständlich, ohne Namen aus dem Code; «(keine)», wenn nichts sichtbar ist
 *   ### Für den Betrieb     Migrationen, Einstellungen, Wartungsläufe; sonst «(keine)»
 *   ### Hinzugefügt …       wie bisher, für die Entwickler der App
 *
 * `collect` sammelt diese Unterabschnitte über alle Versionen zwischen dem Stand beim letzten Release der App und dem
 * jetzigen (Befehl `discussion-notes`). Ohne Abhängigkeiten, damit es auch in Werkzeugen der App läuft.
 */

/** Überschrift eines Versionsabschnitts: `## [1.2.3] – 2026-10-28` (Datum optional, Bindestrich oder Gedankenstrich). */
const HEADING = /^## \[([^\]]+)\](?:\s+[–-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Unterabschnitt mit Text für Nutzer der App. */
export const FOR_USERS = 'Für Nutzer';
/** Unterabschnitt mit Hinweisen für den Betrieb der App. */
export const FOR_OPERATIONS = 'Für den Betrieb';
/** Pakete des Kits (Name im Lockfile der App). */
export const KIT_PACKAGE = /^@vollholz\/discussion(?:-[a-z0-9-]+)?$/;

export interface Section { version: string; date: string | null; body: string }

/** Abschnitte je Version (ohne «Unveröffentlicht»), in der Reihenfolge der Datei. */
export function sections(text: string): Section[] {
  const out: Section[] = [];
  let cur: { version: string; date: string | null; lines: string[] } | null = null;
  const close = () => { if (cur && SEMVER.test(cur.version)) out.push({ version: cur.version, date: cur.date, body: cur.lines.join('\n').trim() }); };
  for (const line of text.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) { close(); cur = { version: m[1]!, date: m[2] ?? null, lines: [] }; continue; }
    // Linkverweise am Ende der Datei gehören zu keinem Abschnitt
    if (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)) { close(); cur = null; continue; }
    cur?.lines.push(line);
  }
  close();
  return out;
}

/** Text eines Unterabschnitts `### <title>` im Abschnitt einer Version; null, wenn er fehlt. */
export function subsection(body: string, title: string): string | null {
  let lines: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (/^### /.test(line)) {
      if (lines) break;
      if (line.slice(4).trim() === title) lines = [];
      continue;
    }
    lines?.push(line);
  }
  return lines ? lines.join('\n').trim() : null;
}

/** «(keine)» oder «- (keine)»: der Unterabschnitt ist bewusst leer. */
export function isNone(text: string): boolean {
  return /^(?:[-*]\s*)?\(keine\)\.?$/i.test(text.trim());
}

/**
 * Vergleich nach SemVer 2.0.0 (Abschnitt 11): Vorabversionen vor der Version selbst; deren Kennungen einzeln, numerische
 * numerisch und vor alphanumerischen, sonst lexikalisch (ASCII); bei gleichem Anfang hat die längere Liste Vorrang.
 */
export function compareVersions(a: string, b: string): number {
  const x = SEMVER.exec(a), y = SEMVER.exec(b);
  if (!x || !y) throw new Error(`keine semantische Version: ${!x ? a : b}`);
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return Math.sign(d); }
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  const p = x[4].split('.'), q = y[4].split('.');
  const num = /^\d+$/;
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    const m = p[i]!, n = q[i]!;
    if (m === n) continue;
    if (num.test(m) && num.test(n)) return Math.sign(Number(m) - Number(n));
    if (num.test(m)) return -1;
    if (num.test(n)) return 1;
    return m < n ? -1 : 1;
  }
  return Math.sign(p.length - q.length);
}

export interface Locked { version: string; path: string }

/**
 * Installierte Versionen der Pakete des Kits aus einem `package-lock.json` (lockfileVersion 2 oder 3), je Paketname alle
 * Fundstellen (`path`: Ordner relativ zum Lockfile, z. B. `node_modules/@vollholz/discussion`).
 */
export function lockedVersions(lockfile: string, match: RegExp = KIT_PACKAGE): Map<string, Locked[]> {
  const lock = JSON.parse(lockfile) as { packages?: Record<string, { version?: string; link?: boolean }> };
  if (!lock.packages) throw new Error('package-lock.json ohne «packages» (lockfileVersion 2 oder 3 nötig)');
  const out = new Map<string, Locked[]>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const i = path.lastIndexOf('node_modules/');
    if (i < 0 || entry.link || !entry.version || !SEMVER.test(entry.version)) continue;
    const name = path.slice(i + 'node_modules/'.length);
    if (!match.test(name)) continue;
    out.set(name, [...(out.get(name) ?? []), { version: entry.version, path }]);
  }
  return out;
}

/** Änderung eines Pakets seit dem letzten Release der App. */
export interface PackageInput {
  name: string;
  /** Version beim letzten Release der App; null: damals nicht eingebunden. */
  from: string | null;
  to: string;
  /** `CHANGELOG.md` der Version `to` (enthält alle früheren Abschnitte); null: nicht gefunden. */
  changelog: string | null;
}

export interface Entry { package: string; version: string; text: string }

export interface PackageChange { name: string; from: string | null; to: string; versions: string[] }

export interface ReleaseNotes {
  /** Pakete mit neuer Version (`versions`: die übernommenen Abschnitte, neueste zuerst; bei neuen Paketen leer). */
  packages: PackageChange[];
  users: Entry[];
  operations: Entry[];
  /** Was fehlt und in den Release Notes der App von Hand zu ergänzen ist. */
  missing: string[];
}

/** Unterabschnitte «Für Nutzer» und «Für den Betrieb» aller Versionen `from < v ≤ to`, je Paket neueste zuerst. */
export function collect(inputs: PackageInput[]): ReleaseNotes {
  const notes: ReleaseNotes = { packages: [], users: [], operations: [], missing: [] };
  for (const p of [...inputs].sort((a, b) => a.name.localeCompare(b.name))) {
    if (p.from === null) {
      // Neu eingebunden: Was das für Nutzer bedeutet, beschreibt die App selbst.
      notes.packages.push({ name: p.name, from: null, to: p.to, versions: [] });
      continue;
    }
    if (compareVersions(p.to, p.from) <= 0) continue;
    if (p.changelog === null) {
      notes.packages.push({ name: p.name, from: p.from, to: p.to, versions: [] });
      notes.missing.push(`${p.name} ${p.from} → ${p.to}: CHANGELOG.md nicht gefunden`);
      continue;
    }
    const range = sections(p.changelog)
      .filter(s => compareVersions(s.version, p.from!) > 0 && compareVersions(s.version, p.to) <= 0)
      .sort((a, b) => compareVersions(b.version, a.version));
    notes.packages.push({ name: p.name, from: p.from, to: p.to, versions: range.map(s => s.version) });
    if (!range.some(s => s.version === p.to)) notes.missing.push(`${p.name} ${p.to}: kein Abschnitt in CHANGELOG.md`);
    for (const s of range) {
      for (const [title, list] of [[FOR_USERS, notes.users], [FOR_OPERATIONS, notes.operations]] as const) {
        const text = subsection(s.body, title);
        if (text === null || text === '') notes.missing.push(`${p.name} ${s.version}: ohne «${title}»`);
        else if (!isNone(text)) list.push({ package: p.name, version: s.version, text });
      }
    }
  }
  return notes;
}

export interface RenderOptions {
  /** Ebene der Überschrift des Blocks (1–5, Standard 3); Unterabschnitte eine Ebene tiefer. */
  level?: number;
  title?: string;
}

/** Block für die Release Notes der App (Markdown); leer, wenn kein Paket eine neue Version hat. */
export function render(notes: ReleaseNotes, options: RenderOptions = {}): string {
  if (!notes.packages.length) return '';
  const level = Math.min(Math.max(Math.trunc(options.level ?? 3), 1), 5);
  const h = (n: number) => '#'.repeat(n);
  const out = [`${h(level)} ${options.title ?? 'Kommentare, Anhänge und Benachrichtigungen'}`, ''];
  const block = (title: string, entries: Entry[]) => {
    if (!entries.length) return;
    out.push(`${h(level + 1)} ${title}`, '', ...entries.map(e => e.text), '');
  };
  block(FOR_USERS, notes.users);
  block(FOR_OPERATIONS, notes.operations);
  if (!notes.users.length && !notes.operations.length && !notes.missing.length) out.push('Keine Änderungen für Nutzer oder Betrieb.', '');
  for (const m of notes.missing) out.push(`> **Unvollständig:** ${m} – aus CHANGELOG.md des Pakets ergänzen.`, '');
  const range = notes.packages.map(p => `${p.name} ${p.from === null ? `neu ${p.to}` : `${p.from} → ${p.to}`}`).join(' · ');
  out.push(`<sub>${range}</sub>`, '');
  return out.join('\n');
}
