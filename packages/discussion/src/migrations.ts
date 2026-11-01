/**
 * Migrationen des Baukastens als SQL mit Platzhaltern (`migrations/discussion_NNN_*.sql`). `discussionMigrations`
 * setzt Schema, Rollen und die Ausdrücke für Mandant und Person ein und liefert sie in der Form, die der Runner von
 * `@vollholz/iam` (`migrate(url, [..., discussionMigrations(...), app])`) erwartet. Jede andere Migrationsbibliothek
 * kann `migrations[i].sql` der Reihe nach ausführen.
 *
 * Die Migrationen sind idempotent und lassen Bestehendes stehen (Apps mit Tabellen aus eigenen Migrationen).
 * Reihenfolge: nach den Tabellen des Personenverzeichnisses (`<schema>.principal`), vor der Migration der App, die
 * `<schema>.discussion_targets(...)` aufruft.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ident } from './http.ts';

export interface DiscussionMigration { name: string; sql: string; checksum: string }

export interface DiscussionMigrationOptions {
  /** Schema der Tabellen (dort liegt auch `principal`). */
  schema: string;
  /** Laufzeit-Rolle der API (z. B. `<app>_app`). */
  app: string;
  /** Worker-Rolle für die Bereinigung (z. B. `<app>_sched`). */
  sched: string;
  /** SQL-Ausdruck für den Mandanten der Anfrage (Standard `app.tenant_id()` von `@vollholz/iam`). */
  tenant?: string;
  /** SQL-Ausdruck für die angemeldete Person (Standard `app.principal_id()` von `@vollholz/iam`). */
  principal?: string;
}

/** Ordner der SQL-Vorlagen (im Paket neben `src` bzw. `dist`). */
export const DISCUSSION_MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

/** Platzhalter `{{name}}` einsetzen; unbekannte Platzhalter sind ein Fehler. */
export function render(sql: string, vars: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!Object.hasOwn(vars, k)) throw new Error(`Unbekannter Platzhalter {{${k}}}`);
    return vars[k]!;
  });
}

/** Ausdruck ohne Semikolon und Kommentar (wird in Policies eingesetzt). */
const expr = (v: string, what: string) => {
  if (!v.trim() || /;|--|\/\*/.test(v)) throw new Error(`${what}: ungültiger Ausdruck «${v}»`);
  return v;
};

export function discussionMigrations(o: DiscussionMigrationOptions): { name: string; migrations: DiscussionMigration[] } {
  const vars = {
    schema: ident(o.schema, 'schema'), app: ident(o.app, 'app'), sched: ident(o.sched, 'sched'),
    tenant: expr(o.tenant ?? 'app.tenant_id()', 'tenant'), principal: expr(o.principal ?? 'app.principal_id()', 'principal'),
  };
  const files = readdirSync(DISCUSSION_MIGRATIONS_DIR).filter(f => /^discussion_\d{3}_[\w-]+\.sql$/.test(f)).sort();
  return {
    name: 'discussion',
    migrations: files.map(f => {
      const sql = render(readFileSync(join(DISCUSSION_MIGRATIONS_DIR, f), 'utf8'), vars).replace(/\r\n/g, '\n');
      return { name: f, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  };
}
