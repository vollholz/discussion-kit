import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collect, isNone, lockedVersions, render, subsection } from '../src/release-notes.ts';

const changelog = `# Changelog

## [Unveröffentlicht]

### Für Nutzer

- noch nicht veröffentlicht

## [1.2.0] – 2026-11-03

### Für Nutzer

- Anhänge lassen sich umbenennen.

### Für den Betrieb

- Neue Migration \`discussion_002\`.

### Hinzugefügt

- \`renameAttachment\`

## [1.1.0] – 2026-11-02

### Für Nutzer

- (keine)

### Für den Betrieb

(keine)

## [1.0.1] – 2026-11-01

### Für Nutzer

- Erwähnungen erscheinen als «@Name»,
  auch beim Bearbeiten.

### Für den Betrieb

- (keine)

## [1.0.0] – 2026-10-01

### Hinzugefügt

- Erste Version.
`;

test('Unterabschnitt lesen, «(keine)» erkennen', () => {
  const body = '### Für Nutzer\n\n- a\n  b\n\n### Für den Betrieb\n\n(keine)\n\n### Behoben\n\n- c';
  assert.equal(subsection(body, 'Für Nutzer'), '- a\n  b');
  assert.equal(subsection(body, 'Für den Betrieb'), '(keine)');
  assert.equal(subsection(body, 'Geändert'), null);
  assert.ok(isNone('- (keine)') && isNone('(keine)') && isNone('* (Keine).'));
  assert.ok(!isNone('- (keine) Ausnahme: X'));
});

test('sammelt Versionen nach der alten bis und mit der neuen, neueste zuerst', () => {
  const notes = collect([{ name: '@vollholz/discussion-web', from: '1.0.0', to: '1.2.0', changelog }]);
  assert.deepEqual(notes.packages, [{ name: '@vollholz/discussion-web', from: '1.0.0', to: '1.2.0', versions: ['1.2.0', '1.1.0', '1.0.1'] }]);
  assert.deepEqual(notes.users.map(e => [e.version, e.text]), [
    ['1.2.0', '- Anhänge lassen sich umbenennen.'],
    ['1.0.1', '- Erwähnungen erscheinen als «@Name»,\n  auch beim Bearbeiten.'],
  ]);
  assert.deepEqual(notes.operations.map(e => e.version), ['1.2.0']);
  assert.deepEqual(notes.missing, []);
});

test('unverändert, neu eingebunden, fehlende Unterabschnitte und CHANGELOG', () => {
  assert.deepEqual(collect([{ name: '@vollholz/discussion', from: '1.2.0', to: '1.2.0', changelog }]).packages, []);
  const neu = collect([{ name: '@vollholz/discussion', from: null, to: '1.2.0', changelog }]);
  assert.deepEqual([neu.packages[0]!.versions, neu.users, neu.missing], [[], [], []]);
  const alt = collect([{ name: '@vollholz/discussion', from: '0.9.0', to: '1.0.0', changelog }]);
  assert.deepEqual(alt.missing, ['@vollholz/discussion 1.0.0: ohne «Für Nutzer»', '@vollholz/discussion 1.0.0: ohne «Für den Betrieb»']);
  assert.match(collect([{ name: '@vollholz/discussion', from: '1.0.0', to: '1.3.0', changelog }]).missing.join('\n'), /1\.3\.0: kein Abschnitt/);
  assert.match(collect([{ name: '@vollholz/discussion', from: '1.0.0', to: '1.1.0', changelog: null }]).missing[0]!, /nicht gefunden/);
});

test('Block für die Release Notes der App', () => {
  const md = render(collect([
    { name: '@vollholz/discussion-web', from: '1.0.0', to: '1.2.0', changelog },
    { name: '@vollholz/discussion', from: '1.1.0', to: '1.1.0', changelog },
  ]), { level: 2 });
  assert.equal(md, `## Kommentare, Anhänge und Benachrichtigungen

### Für Nutzer

- Anhänge lassen sich umbenennen.
- Erwähnungen erscheinen als «@Name»,
  auch beim Bearbeiten.

### Für den Betrieb

- Neue Migration \`discussion_002\`.

<sub>@vollholz/discussion-web 1.0.0 → 1.2.0</sub>
`);
  assert.equal(render(collect([])), '');
  assert.match(render(collect([{ name: '@vollholz/discussion', from: '1.0.1', to: '1.1.0', changelog }])), /Keine Änderungen für Nutzer oder Betrieb\./);
});

test('Versionen aus package-lock.json (auch in Workspaces, ohne Links)', () => {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: {
    '': { name: 'app' },
    'node_modules/@vollholz/discussion': { version: '1.1.0' },
    'apps/web/node_modules/@vollholz/discussion-web': { version: '1.0.2' },
    'node_modules/@vollholz/discussion-web': { version: '1.0.1' },
    'node_modules/@vollholz/discussion-tools': { resolved: 'packages/tools', link: true },
    'node_modules/@vollholz/iam': { version: '3.0.0' },
  } });
  const v = lockedVersions(lock);
  assert.deepEqual([...v.keys()].sort(), ['@vollholz/discussion', '@vollholz/discussion-web']);
  assert.deepEqual(v.get('@vollholz/discussion-web')!.map(l => l.version), ['1.0.2', '1.0.1']);
  assert.throws(() => lockedVersions('{"lockfileVersion":1,"dependencies":{}}'), /lockfileVersion 2 oder 3/);
});

test('Befehl discussion-notes: seit letztem Tag der App', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discussion-notes-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    const lock = (version: string) => JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@vollholz/discussion-web': { version } } });
    git('init', '-q');
    git('config', 'user.email', 'test@example.ch');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    writeFileSync(join(dir, 'package-lock.json'), lock('1.0.0'));
    git('add', '.');
    git('commit', '-qm', 'App 1.0.0');
    git('tag', 'v1.0.0');
    writeFileSync(join(dir, 'package-lock.json'), lock('1.2.0'));
    mkdirSync(join(dir, 'node_modules/@vollholz/discussion-web'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/@vollholz/discussion-web/CHANGELOG.md'), changelog);

    const cli = join(import.meta.dirname, '../src/notes-cli.ts');
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
    const md = run();
    assert.equal(md.status, 0, md.stderr);
    assert.match(md.stdout, /^### Kommentare, Anhänge und Benachrichtigungen\n\n#### Für Nutzer\n\n- Anhänge lassen sich umbenennen\.\n- Erwähnungen/);
    assert.match(md.stdout, /<sub>@vollholz\/discussion-web 1\.0\.0 → 1\.2\.0<\/sub>/);

    const json = run('--seit', 'v1.0.0', '--json');
    assert.equal(json.status, 0, json.stderr);
    const parsed = JSON.parse(json.stdout) as { seit: string; packages: { versions: string[] }[] };
    assert.deepEqual([parsed.seit, parsed.packages[0]!.versions], ['v1.0.0', ['1.2.0', '1.1.0', '1.0.1']]);

    assert.equal(run('--ebene', '9').status, 64);
    assert.equal(run('--seit', 'gibt-es-nicht').status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
