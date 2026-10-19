import { AlertTriangle, CalendarClock, CalendarPlus, CalendarX2, Link2Off, MessageSquareText, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { markAllNotificationsRead } from "@/app/(app)/notification-actions";
import { PageContainer } from "@/components/layout/page";
import { Button, TextLink } from "@/components/ui/button";
import { EmptyState, Notice, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getNotifications } from "@/lib/data/notifications";
import { notificationText, type NotificationKind } from "@/lib/notifications/messages";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

const ICONS: Record<NotificationKind, typeof CalendarPlus> = {
  session_published: CalendarPlus,
  session_updated: CalendarClock,
  session_cancelled: CalendarX2,
  comment: MessageSquareText,
  reconnect: Link2Off,
  export_failed: AlertTriangle,
  missing_feedback: PenLine,
};

export default function NotificationsPage() {
  return (
    <PageContainer>
      <PageHeader title="Notifications" description="Séances programmées ou modifiées, commentaires et rappels. Réglez ce que vous recevez dans les réglages." />
      <Suspense fallback={<SectionSkeleton />}>
        <NotificationList />
      </Suspense>
    </PageContainer>
  );
}

async function NotificationList() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/notifications"), getProfile()]);
  const items = await getNotifications(supabase);
  if (items === null) return <Notice>Les notifications seront disponibles après la mise à jour de la base de données du site.</Notice>;
  if (!items.length) {
    return (
      <EmptyState title="Aucune notification">
        Vous serez prévenu ici quand une séance est programmée, modifiée ou commentée.{" "}
        <TextLink href="/settings#notifications">Régler les notifications</TextLink>
      </EmptyState>
    );
  }
  const unread = items.filter((n) => !n.read_at).length;
  const stamp = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: profile.timezone });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">{unread ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est lu."}</p>
        <div className="flex items-center gap-3">
          <TextLink href="/settings#notifications" className="text-[13px]">
            Régler
          </TextLink>
          {unread ? (
            <form action={markAllNotificationsRead}>
              <Button type="submit" size="sm" variant="secondary">
                Tout marquer comme lu
              </Button>
            </form>
          ) : null}
        </div>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <li key={item.id}>
              <Link href={`/notifications/${item.id}`} prefetch={false} className={cn("flex items-start gap-3 px-4 py-3 hover:bg-surface-2", !item.read_at && "bg-surface-2/60")}>
                <Icon aria-hidden className={cn("mt-0.5 size-[18px] shrink-0", item.kind === "export_failed" || item.kind === "reconnect" ? "text-warning" : "text-muted")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[14px] leading-snug", item.read_at ? "text-ink-soft" : "font-semibold text-ink")}>{notificationText(item, userId)}</span>
                  <span className="mt-0.5 block text-[12px] text-muted">{stamp.format(new Date(item.created_at))}</span>
                </span>
                {!item.read_at ? <span aria-label="Non lue" className="mt-1.5 size-2 shrink-0 rounded-full bg-ink" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
