/**
 * Darstellung der Markdown-Teilmenge von Kommentaren ohne HTML-Injection: der Text wird in React-Elemente zerlegt,
 * nie als HTML eingefügt. Unterstützt: Absätze, Zeilenumbrüche, Listen («- » oder «* »), **fett**, *kursiv*,
 * `Code`, Links [Text](https://…) und nackte http(s)-Adressen (nur http/https, öffnen in neuem Tab ohne Opener),
 * Erwähnungen @[Name](id) (die eigene mit `me` hervorgehoben). Alles andere bleibt sichtbarer Text, auch spitze Klammern.
 */
import type { ReactNode } from 'react';

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s][^*\n]*?\*)|(@\[[^\]\n]{1,200}\]\([0-9a-fA-F-]{36}\))|(\[[^\]\n]{1,500}\]\([^)\s]{1,2000}\))|(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"])/g;

/** Nur http(s)-Adressen werden zu Links (kein javascript:, data: usw.). */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

function inline(text: string, names: Map<string, string>, key: string, me: string | null): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0], k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), names, k, me)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(t.slice(1, -1), names, k, me)}</em>);
    else if (m[4]) {
      const mm = /^@\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const id = mm[2]!.toLowerCase();
      out.push(<span key={k} className={id === me ? 'mention me' : 'mention'} data-person={id}>@{names.get(id) ?? mm[1]}</span>);
    } else if (m[5]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const href = safeUrl(mm[2]!);
      out.push(href ? <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">{mm[1]}</a> : t);
    } else {
      const href = safeUrl(t);
      out.push(href ? <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">{t}</a> : t);
    }
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const withBreaks = (lines: string[], names: Map<string, string>, key: string, me: string | null) =>
  lines.flatMap((l, i) => (i ? [<br key={`${key}-br${i}`} />, ...inline(l, names, `${key}-${i}`, me)] : inline(l, names, `${key}-${i}`, me)));

export function CommentText({ text, mentions = [], me = null }: { text: string; mentions?: { id: string; name: string }[]; me?: string | null }) {
  const names = new Map(mentions.map(m => [m.id.toLowerCase(), m.name]));
  const self = me?.toLowerCase() ?? null;
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).filter(b => b.trim());
  return (
    <div className="md">
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every(l => /^\s*[-*] /.test(l))) {
          return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*] /, ''), names, `${bi}-${li}`, self)}</li>)}</ul>;
        }
        return <p key={bi}>{withBreaks(lines, names, String(bi), self)}</p>;
      })}
    </div>
  );
}
