import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "error" | "success" | "warning" | "info";

const tones: Record<Tone, { box: string; icon: typeof Info }> = {
  error: { box: "border-danger/25 bg-danger-soft text-danger", icon: XCircle },
  success: { box: "border-success/25 bg-success-soft text-success", icon: CheckCircle2 },
  warning: { box: "border-warning/25 bg-warning-soft text-warning", icon: AlertTriangle },
  info: { box: "border-line bg-surface-2 text-ink-soft", icon: Info },
};

export function Notice({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const { box, icon: Icon } = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-[14px] leading-snug", box, className)}
    >
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Message de résultat d’un formulaire (erreur ou succès), annoncé aux lecteurs d’écran. */
export function FormMessage({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "error" && state.message) return <Notice tone="error">{state.message}</Notice>;
  if (state.status === "success" && state.message) return <Notice tone="success">{state.message}</Notice>;
  return null;
}

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[14px] border border-dashed border-line-strong px-5 py-8 text-center", className)}>
      <p className="heading text-[16px]">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-[14px] text-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Squelette de chargement neutre. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-[8px] bg-surface-2", className)} />;
}

export function SectionSkeleton() {
  return (
    <div className="space-y-3" aria-label="Chargement" role="status">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
