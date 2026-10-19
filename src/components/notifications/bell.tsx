import { Bell } from "lucide-react";
import Link from "next/link";
import { getSession } from "@/lib/auth/dal";
import { getUnreadCount } from "@/lib/data/notifications";
import { cn } from "@/lib/utils";

/** Cloche des notifications, avec le nombre de non lues ; absente tant que la base n'est pas à jour. */
export async function NotificationBell({ className }: { className?: string }) {
  const session = await getSession();
  if (!session) return null;
  const count = await getUnreadCount(session.supabase);
  if (count === null) return null;
  return (
    <Link
      href="/notifications"
      aria-label={count ? `Notifications : ${count} non lue${count > 1 ? "s" : ""}` : "Notifications"}
      className={cn("relative flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-surface-2 hover:text-ink", className)}
    >
      <Bell className="size-5" aria-hidden />
      {count ? (
        <span aria-hidden className="figure absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-ink px-1 text-center text-[10.5px] font-bold leading-[18px] text-canvas ring-2 ring-surface">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}
