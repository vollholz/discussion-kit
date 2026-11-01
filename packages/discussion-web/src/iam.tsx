/**
 * Adapter für Apps mit `@vollholz/iam-web` (Einstieg `@vollholz/discussion-web/iam`): Sitzung, Rechte, Organisation
 * je Tab, CSRF, Personensuche, Meldungen, Fehler und Grundbausteine kommen aus dem IAM-Paket der App – die Komponenten
 * sehen aus wie der Rest der App.
 *
 * ```tsx
 * <IamDiscussionProvider targets={TARGETS}><CommentsPanel target={…} /></IamDiscussionProvider>
 * ```
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, Confirm, ErrorBox, Loading, MissingRight, Modal, searchPeople, tenantHeaders, useIam, useIamUi, usePeople, withTenant } from '@vollholz/iam-web';
import { useMemo, type ReactNode } from 'react';
import { DiscussionProvider, type DiscussionConfig, type TargetConfig } from './config.tsx';
import type { DiscussionComponents } from './ui.tsx';

const components: Partial<DiscussionComponents> = {
  Loading, ErrorBox, Confirm, Modal,
  MissingRight: ({ perm, lead }) => <MissingRight perm={perm as never} lead={lead} />,
};

/** Konfiguration aus der IAM-Sitzung; `over` ersetzt einzelne Teile (z. B. eigene Grundbausteine der App). */
export function useIamDiscussion(targets: Record<string, TargetConfig>, over: Partial<DiscussionConfig> = {}): DiscussionConfig {
  const { me, can } = useIam();
  const { toast } = useIamUi();
  const people = usePeople();
  const qc = useQueryClient();
  // Principal-ID im Mandanten der Organisation dieses Tabs (GET /v1/me der API), wenn die App sie nicht selbst liefert
  const meQ = useQuery({
    enabled: !('me' in over),
    queryKey: ['discussion', 'me', me.tenant?.alias ?? null],
    queryFn: async () => (await (await fetch(`${window.location.origin}/v1/me`, { credentials: 'same-origin', headers: { Accept: 'application/json', ...tenantHeaders('GET') } })).json() as { principal?: { id: string } }).principal?.id ?? null,
    staleTime: 5 * 60_000,
  });
  const principal = meQ.data ?? null;
  return useMemo<DiscussionConfig>(() => ({
    targets, me: principal,
    can: perm => can(perm as never),
    headers: () => tenantHeaders('POST'),
    link: withTenant,
    searchPeople: async (q, limit) => (await searchPeople(qc, people, q, new AbortController().signal)).slice(0, limit).map(p => ({ id: p.id, name: p.name, email: p.email ?? null })),
    toast: { show: text => toast.show(text), error: (e, title) => toast.error(e, title) },
    toError: (status, problem, requestId) => new ApiError(status, problem as never, requestId),
    components,
    ...over,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [targets, principal, can, toast, people, qc, ...Object.values(over)]);
}

export function IamDiscussionProvider({ targets, children, ...over }: { targets: Record<string, TargetConfig>; children: ReactNode } & Partial<DiscussionConfig>) {
  return <DiscussionProvider {...useIamDiscussion(targets, over)}>{children}</DiscussionProvider>;
}
