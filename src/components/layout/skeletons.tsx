import { Skeleton } from "@/components/ui/feedback";
import { PageContainer } from "./page";

export function CalendarSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Chargement du calendrier">
      <Skeleton className="h-16 w-72" />
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-[560px] w-full" />
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <PageContainer wide>
      <div className="space-y-4" role="status" aria-label="Chargement de l’éditeur">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    </PageContainer>
  );
}
