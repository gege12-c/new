import type { ReactNode } from "react";
import { Brand, BrandMark } from "@/components/brand";
import { WorkoutProfile } from "@/components/workout/workout-profile";
import { WorkoutSchema } from "@/lib/workout/schema";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { APP_NAME } from "@/lib/utils";

const example = WorkoutSchema.parse(bikeThreshold);

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <aside className="relative hidden overflow-hidden bg-night text-night-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <span className="inline-flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em]" style={{ fontStretch: "112%" }}>
          <BrandMark />
          {APP_NAME}
        </span>
        <div>
          <p className="display max-w-[16ch] text-[44px]">Chaque séance a une forme. Celle-ci, c’est 4 × 8 min au seuil.</p>
          <WorkoutProfile workout={example} thresholds={{ bike: { ftpW: 250 } }} height={140} thresholdLine className="mt-12 text-night-ink" />
        </div>
        <p className="text-[13px] text-night-muted">Calendrier, séances structurées et suivi, entre l’athlète et son coach.</p>
      </aside>
      <div className="flex min-h-dvh flex-col bg-surface px-5 py-8 sm:px-10">
        <Brand className="lg:hidden" />
        <main className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">{children}</main>
      </div>
    </div>
  );
}
