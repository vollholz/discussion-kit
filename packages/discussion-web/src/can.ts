/** Fähigkeiten am Ziel (`can` der Antworten der App); fehlt ein Wert, gilt das Recht auf Ebene der Organisation. */
import type { Discussion } from './config.tsx';

export interface DiscussionCan { comment?: boolean; moderateComments?: boolean; attach?: boolean; deleteAttachments?: boolean }

export function allowed(d: Pick<Discussion, 'can'>, caps: DiscussionCan | undefined, key: keyof DiscussionCan, perm: string): boolean {
  const v = caps?.[key];
  return typeof v === 'boolean' ? v : d.can(perm);
}
