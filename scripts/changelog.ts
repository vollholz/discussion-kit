/**
 * Release Notes der Pakete (packages/<paket>/CHANGELOG.md, «Keep a Changelog»). Regel: keine neue Version ohne
 * Eintrag. Jede Version eines Pakets hat in dessen CHANGELOG.md einen Abschnitt `## [<version>] – <datum>`, der mit den
 * Unterabschnitten `### Für Nutzer` und `### Für den Betrieb` beginnt (Text oder «(keine)»; Sammeln für die Release
 * Notes der Apps: `discussion-notes`, packages/discussion/src/release-notes.ts).
 *
 *   node scripts/changelog.ts check [--base <git-ref>]   CI: aktuelle Version jedes Pakets hat einen Abschnitt; mit
 *                                                        --base zusätzlich keine kleinere Version als im Basis-Stand
 *   node scripts/changelog.ts notes <paket-ordner> <version>   Text des Abschnitts (GitHub Release, release.yml)
 *
 * Exit 0 ok, 1 Befund, 64 Aufruf falsch.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { compareVersions, FOR_OPERATIONS, FOR_USERS, sections, subsection, type Section } from '../packages/discussion/src/release-notes.ts';

const root = join(import.meta.dirname, '..');

export { compareVersions, sections, type Section };

interface Pkg { dir: string; name: string; version: string }

function packages(): Pkg[] {
  const base = join(root, 'packages');
  return readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(base, d.name, 'package.json')))
    .map(d => ({ dir: join(base, d.name), json: JSON.parse(readFileSync(join(base, d.name, 'package.json'), 'utf8')) as { name: string; version: string; private?: boolean } }))
    .filter(p => !p.json.private).map(p => ({ dir: p.dir, name: p.json.name, version: p.json.version }));
}

/** Version des Pakets im Basis-Stand; null, wenn es das Paket dort nicht gab. */
function baseVersion(ref: string, p: Pkg): string | null {
  // git show erwartet «/» im Pfad, auch unter Windows (relative liefert dort «\»)
  const path = relative(root, join(p.dir, 'package.json')).replaceAll(sep, '/');
  try {
    const raw = execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return (JSON.parse(raw) as { version: string }).version;
  } catch { return null; }
}

/** Befunde zu einem Paket (leer: in Ordnung). */
export function problems(p: Pkg, changelog: string | null, before: string | null): string[] {
  const file = `${relative(root, p.dir)}/CHANGELOG.md`;
  if (changelog === null) return [`${file} fehlt (${p.name}@${p.version})`];
  const out: string[] = [];
  const all = sections(changelog);
  const own = all.filter(s => s.version === p.version);
  if (!own.length) out.push(`${file}: Abschnitt «## [${p.version}] – <datum>» fehlt (${p.name}@${p.version})`);
  else if (own.length > 1) out.push(`${file}: Abschnitt ${p.version} kommt mehrfach vor`);
  else if (!own[0]!.body) out.push(`${file}: Abschnitt ${p.version} ist leer`);
  else if (!own[0]!.date) out.push(`${file}: Abschnitt ${p.version} ohne Datum («## [${p.version}] – JJJJ-MM-TT»)`);
  if (own.length === 1 && own[0]!.body) {
    for (const title of [FOR_USERS, FOR_OPERATIONS]) {
      const text = subsection(own[0]!.body, title);
      if (text === null) out.push(`${file}: Abschnitt ${p.version} ohne «### ${title}» (Text oder «(keine)»)`);
      else if (!text) out.push(`${file}: «### ${title}» in ${p.version} ist leer (Text oder «(keine)»)`);
    }
    const first = /^### (.+)$/m.exec(own[0]!.body)?.[1]?.trim();
    if (first && first !== FOR_USERS && subsection(own[0]!.body, FOR_USERS) !== null) out.push(`${file}: Abschnitt ${p.version} beginnt nicht mit «### ${FOR_USERS}»`);
  }
  if (all[0] && all[0].version !== p.version && own.length) out.push(`${file}: Abschnitt ${p.version} steht nicht zuoberst (zuoberst: ${all[0].version})`);
  if (before && compareVersions(p.version, before) < 0) out.push(`${p.name}: Version ${p.version} ist kleiner als im Basis-Stand (${before})`);
  return out;
}

function check(base: string | null): number {
  const found: string[] = [];
  for (const p of packages()) {
    const path = join(p.dir, 'CHANGELOG.md');
    const before = base ? baseVersion(base, p) : null;
    const pr = problems(p, existsSync(path) ? readFileSync(path, 'utf8') : null, before);
    found.push(...pr);
    const bumped = base && before !== p.version ? ` (erhöht von ${before ?? 'neu'})` : '';
    if (!pr.length) console.log(`ok: ${p.name}@${p.version}${bumped}`);
  }
  for (const f of found) console.error(`::error::${f}`);
  if (found.length) console.error('Regel: keine neue Version ohne CHANGELOG-Eintrag (README.md, docs/ausrollen.md).');
  return found.length ? 1 : 0;
}

function notes(dir: string, version: string): number {
  const path = join(dir, 'CHANGELOG.md');
  const s = existsSync(path) ? sections(readFileSync(path, 'utf8')).find(x => x.version === version) : undefined;
  if (!s?.body) { console.error(`${path}: kein Abschnitt für ${version}`); return 1; }
  process.stdout.write(`${s.body}\n`);
  return 0;
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const usage = 'Aufruf: changelog.ts check [--base <ref>] | notes <paket-ordner> <version>';
  let code = 64;
  if (cmd === 'check') {
    const i = rest.indexOf('--base');
    code = i >= 0 && !rest[i + 1] ? 64 : check(i >= 0 ? rest[i + 1]! : null);
  } else if (cmd === 'notes' && rest.length === 2) code = notes(rest[0]!, rest[1]!);
  if (code === 64) console.error(usage);
  process.exit(code);
}
