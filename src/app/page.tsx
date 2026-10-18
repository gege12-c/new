import Link from "next/link";
import { Brand } from "@/components/brand";
import { SportDot } from "@/components/sport";
import { ButtonLink } from "@/components/ui/button";
import { WorkoutProfile } from "@/components/workout/workout-profile";
import { computeTotals, expandWorkout, resolveTarget } from "@/lib/workout/compute";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { formatDuration, summarizeNodes } from "@/lib/workout/format";
import { WorkoutSchema } from "@/lib/workout/schema";

// Séance d'exemple réelle, calculée par le moteur de l'application (FTP de 250 W).
const example = WorkoutSchema.parse(bikeThreshold);
const exampleThresholds = { bike: { ftpW: 250 } };
const exampleTotals = computeTotals(example, exampleThresholds);
const workStep = expandWorkout(example).find((f) => f.step.type === "active")!.step;
const workTarget = resolveTarget(workStep.targets[0], "bike", exampleThresholds);
const workWatts = workTarget.ok ? workTarget.target : null;

export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex h-16 items-center justify-between">
        <Brand />
        <Link href="/login" className="text-[15px] font-medium text-accent">
          Se connecter
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-12 py-12 lg:flex-row lg:items-center lg:gap-16">
        <div className="max-w-xl">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight sm:text-[44px]">
            Le plan du coach et la séance de l&apos;athlète, au même endroit.
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-muted">
            Le coach programme depuis son navigateur, sans rien installer. L&apos;athlète retrouve chaque séance sur son téléphone,
            avec ses cibles exactes, calculées à partir de ses propres seuils.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/signup">Créer un compte</ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Se connecter
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-muted">
            Import des activités Strava et export vers Garmin, Zwift, Wahoo et Suunto : en cours de développement.
          </p>
        </div>

        <figure className="w-full max-w-md rounded-lg border border-line bg-surface p-5">
          <figcaption className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-medium">
              <SportDot sport="bike" />
              {example.segments[0].title}
            </span>
            <span className="tabular text-sm text-muted">{formatDuration(exampleTotals.duration.value)}</span>
          </figcaption>
          <WorkoutProfile workout={example} thresholds={exampleThresholds} className="mt-5" height={112} />
          <p className="mt-4 text-sm leading-relaxed text-muted">{summarizeNodes(example.segments[0].steps, "bike")}</p>
          {workWatts ? (
            <p className="mt-3 border-t border-line pt-3 text-sm">
              Pour une FTP de 250 W, les blocs au seuil se font entre{" "}
              <span className="tabular font-semibold">
                {workWatts.min} et {workWatts.max} W
              </span>
              .
            </p>
          ) : null}
        </figure>
      </main>
    </div>
  );
}
