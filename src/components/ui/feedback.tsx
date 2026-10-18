import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "error" | "success" | "warning" | "info";

const tones: Record<Tone, string> = {
  error: "border-danger/30 bg-danger-soft text-danger",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  info: "border-line bg-surface-2 text-ink",
};

export function Notice({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}

/** Message de résultat d'un formulaire (erreur ou succès), annoncé aux lecteurs d'écran. */
export function FormMessage({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "error" && state.message) return <Notice tone="error">{state.message}</Notice>;
  if (state.status === "success" && state.message) return <Notice tone="success">{state.message}</Notice>;
  return null;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Squelette de chargement neutre. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
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
