/**
 * @vollholz/discussion-web – Oberfläche zu `@vollholz/discussion` (React): Kommentare, Anhänge, Glocke.
 *
 * ```tsx
 * import '@vollholz/discussion-web/styles.css';
 * <DiscussionProvider targets={{ order: { basePath: '/v1/orders', here: 'zu diesem Auftrag', restricted: 'Für diesen Auftrag' } }}
 *   me={principalId} can={perm => rights.includes(perm)} headers={() => ({ 'X-CSRF-Token': csrf })}>
 *   <CommentsPanel target={{ type: 'order', id }} can={order.can} />
 * </DiscussionProvider>
 * ```
 * Apps mit `@vollholz/iam-web`: `useIamDiscussion` aus `@vollholz/discussion-web/iam` liefert die Konfiguration.
 */
export { DiscussionProvider, useDiscussion, useToaster, type Discussion, type DiscussionConfig, type NotificationKind, type Person, type ProblemBody, type TargetConfig, type Toaster } from './config.tsx';
export { CommentsPanel } from './CommentsPanel.tsx';
export { AttachmentsPanel } from './AttachmentsPanel.tsx';
export { NotificationBell, type InboxTarget } from './NotificationBell.tsx';
export { CommentsOverview } from './CommentsOverview.tsx';
export { CommentText, safeUrl } from './markdown.tsx';
export type { DiscussionCan } from './can.ts';
export {
  contentUrl, dkKeys, mentionToken, request, uploadAttachment, useAttachments, useCommentMutations, useCommentOverview, useComments, useDeleteAttachment, useDiscussionCounts,
  useMarkRead, useNotifications, type Attachment, type Comment, type Notification, type OverviewComment, type OverviewFilter, type PersonRef, type Revision, type Target,
} from './api.ts';
export { DiscussionApiError, fmtBytes, Icon, type DiscussionComponents } from './ui.tsx';
