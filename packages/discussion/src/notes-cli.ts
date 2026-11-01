#!/usr/bin/env node
/**
 * discussion-notes – Release Notes der Pakete des Kits seit dem letzten Release der App, als Block für deren Release
 * Notes (Unterabschnitte «Für Nutzer» und «Für den Betrieb» aus CHANGELOG.md der installierten Pakete).
 *
 *   npx discussion-notes [--seit <git-ref>] [--lockfile <pfad>] [--ebene <1-5>] [--json]
 *
 *   --seit       Stand des letzten App-Releases (Tag, Commit); Standard: letzter Tag (`git describe --tags --abbrev=0`)
 *   --lockfile   package-lock.json der App; Standard: ./package-lock.json
 *   --ebene      Ebene der Überschrift des Blocks (Standard 3)
 *   --json       Ergebnis als JSON statt Markdown
 *
 * Exit 0 ok (Hinweise auf Fehlendes zusätzlich auf stderr), 1 Fehler, 64 Aufruf falsch.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { collect, compareVersions, lockedVersions, render, type Locked, type PackageInput } from './release-notes.ts';

const USAGE = 'Aufruf: discussion-notes [--seit <git-ref>] [--lockfile <pfad>] [--ebene <1-5>] [--json]';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const newest = (list: Locked[]) => list.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
const oldest = (list: Locked[]) => list.reduce((a, b) => (compareVersions(b.version, a.version) < 0 ? b : a));

function main(argv: string[]): number {
  const opts: { seit?: string; lockfile: string; ebene?: number; json: boolean } = { lockfile: 'package-lock.json', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!, v = argv[i + 1];
    if (a === '--json') opts.json = true;
    else if ((a === '--seit' || a === '--lockfile' || a === '--ebene') && v && !v.startsWith('--')) {
      i++;
      if (a === '--seit') opts.seit = v;
      else if (a === '--lockfile') opts.lockfile = v;
      else if (!/^[1-5]$/.test(v)) { console.error(USAGE); return 64; }
      else opts.ebene = Number(v);
    } else { console.error(USAGE); return 64; }
  }

  const lockPath = resolve(opts.lockfile);
  if (!existsSync(lockPath)) { console.error(`${lockPath} fehlt`); return 1; }
  const dir = dirname(lockPath);
  let ref = opts.seit;
  if (!ref) {
    try { ref = git(dir, ['describe', '--tags', '--abbrev=0']).trim(); } catch {
      console.error('Kein Tag gefunden: Stand des letzten App-Releases mit --seit <git-ref> angeben.');
      return 64;
    }
  }
  try { git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch {
    console.error(`${ref}: kein Commit, Tag oder Branch`);
    return 1;
  }

  const now = lockedVersions(readFileSync(lockPath, 'utf8'));
  let before = new Map<string, Locked[]>();
  try { before = lockedVersions(git(dir, ['show', `${ref}:./${basename(lockPath)}`])); } catch {
    // Lockfile gab es damals nicht: alle Pakete gelten als neu eingebunden.
  }

  const inputs: PackageInput[] = [...now].map(([name, list]) => {
    const to = newest(list);
    const old = before.get(name);
    const changelog = join(dir, to.path, 'CHANGELOG.md');
    return { name, from: old ? oldest(old).version : null, to: to.version, changelog: existsSync(changelog) ? readFileSync(changelog, 'utf8') : null };
  });
  const notes = collect(inputs);

  process.stdout.write(opts.json ? `${JSON.stringify({ seit: ref, ...notes }, null, 2)}\n` : render(notes, { level: opts.ebene }));
  if (!notes.packages.length) console.error(`Keine neuen Versionen der Pakete des Kits seit ${ref}.`);
  for (const m of notes.missing) console.error(`Hinweis: ${m}`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
