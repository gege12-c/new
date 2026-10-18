import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";
import { WorkoutProfile } from "@/components/workout/workout-profile";
import { computeTotals, resolveTarget } from "@/lib/workout/compute";
import { formatDuration } from "@/lib/workout/format";
import { WorkoutSchema, type WorkoutInput } from "@/lib/workout/schema";
import { APP_NAME } from "@/lib/utils";

export const metadata: Metadata = { title: { absolute: `${APP_NAME} – coaching triathlon` } };

const pct = (min: number, max: number) => [{ metric: "power" as const, unit: "percent_ftp" as const, min, max }];

/** Séance d’exemple, calculée par le moteur de l’application pour une FTP de 250 W. */
const exampleInput: WorkoutInput = {
  schemaVersion: 1,
  segments: [
    {
      id: "hero",
      sport: "bike",
      title: "Sweet spot et rappels de puissance",
      steps: [
        { kind: "step", id: "w1", type: "warmup", length: { unit: "time", seconds: 300 }, targets: pct(50, 55) },
        { kind: "step", id: "w2", type: "warmup", length: { unit: "time", seconds: 300 }, targets: pct(60, 65) },
        { kind: "step", id: "w3", type: "warmup", length: { unit: "time", seconds: 300 }, targets: pct(70, 75) },
        {
          kind: "repeat",
          id: "spikes",
          count: 2,
          steps: [
            {
              kind: "repeat",
              id: "spike",
              count: 5,
              steps: [
                { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 40 }, targets: pct(125, 135) },
                { kind: "step", id: "off", type: "recovery", length: { unit: "time", seconds: 20 }, targets: pct(45, 50) },
              ],
            },
            { kind: "step", id: "rest", type: "recovery", length: { unit: "time", seconds: 240 }, targets: pct(50, 55) },
          ],
        },
        {
          kind: "repeat",
          id: "ss",
          count: 2,
          steps: [
            { kind: "step", id: "ss-on", type: "active", length: { unit: "time", seconds: 720 }, targets: pct(88, 93) },
            { kind: "step", id: "ss-off", type: "recovery", length: { unit: "time", seconds: 240 }, targets: pct(50, 55) },
          ],
        },
        { kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 480 }, targets: pct(45, 55) },
      ],
    },
  ],
};

const example = WorkoutSchema.parse(exampleInput);
const thresholds = { bike: { ftpW: 250 } };
const totals = computeTotals(example, thresholds);
const watts = (min: number, max: number) => {
  const r = resolveTarget(pct(min, max)[0], "bike", thresholds);
  return r.ok ? `${r.target.min}–${r.target.max} W` : "";
};

const COACH = [
  "Un calendrier par athlète, en vue mois, semaine, jour ou liste.",
  "Un éditeur de séances structurées : blocs, répétitions, cibles en watts, allure ou fréquence cardiaque.",
  "Une bibliothèque de modèles, la copie d’une semaine entière, le glisser-déposer.",
];

const ATHLETE = [
  "La séance du jour et la suivante, dès l’ouverture, sur téléphone.",
  "Des cibles calculées sur vos propres seuils : FTP, allure seuil, CSS, FC.",
  "Chaque modification du coach arrive en quelques secondes, sans recharger.",
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <section className="bg-night text-night-ink">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
          <header className="flex h-[72px] items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em]" style={{ fontStretch: "112%" }}>
              <BrandMark />
              {APP_NAME}
            </Link>
            <nav className="flex items-center gap-1 sm:gap-2">
              <Link href="/login" className="rounded-[8px] px-3 py-2 text-[14px] font-medium text-night-ink/85 hover:bg-white/8 hover:text-night-ink">
                Se connecter
              </Link>
              <Link
                href="/signup"
                className="hidden rounded-[8px] bg-night-ink px-4 py-2 text-[14px] font-semibold text-night hover:opacity-90 sm:inline-flex"
              >
                Créer un compte
              </Link>
            </nav>
          </header>

          <div className="pb-6 pt-14 sm:pt-20 lg:pt-24">
            <h1 className="display max-w-[15ch] text-[44px] sm:text-[64px] lg:text-[80px]">
              Le plan du coach, la séance de l’athlète.
            </h1>
            <p className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-night-muted sm:text-[19px]">
              Le coach programme depuis son navigateur, sans rien installer. L’athlète retrouve chaque séance sur son téléphone, avec des
              cibles calculées sur ses propres seuils.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center rounded-[10px] bg-night-ink px-6 text-[15px] font-semibold text-night hover:opacity-90"
              >
                Créer un compte
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-[10px] border border-white/20 px-6 text-[15px] font-medium text-night-ink hover:bg-white/8"
              >
                Se connecter
              </Link>
            </div>
          </div>

          <figure className="pb-12 pt-10 sm:pb-16">
            <WorkoutProfile workout={example} thresholds={thresholds} height={200} animate thresholdLine className="text-night-ink" />
            <figcaption className="mt-5 grid gap-x-8 gap-y-3 border-t border-white/12 pt-5 text-[14px] text-night-muted sm:grid-cols-[auto_1fr_auto] sm:items-baseline">
              <span className="font-semibold text-night-ink">{example.segments[0].title}</span>
              <span>
                2 × 5 rappels de 40 s à <span className="figure text-night-ink">{watts(125, 135)}</span>, puis 2 × 12 min à{" "}
                <span className="figure text-night-ink">{watts(88, 93)}</span> pour une FTP de 250 W.
              </span>
              <span className="figure text-[22px] text-night-ink">{formatDuration(totals.duration.value)}</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1180px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-2 md:py-24">
        {[
          { title: "Pour le coach", items: COACH },
          { title: "Pour l’athlète", items: ATHLETE },
        ].map((column) => (
          <div key={column.title}>
            <h2 className="heading text-[24px]">{column.title}</h2>
            <ul className="mt-5 space-y-4">
              {column.items.map((item) => (
                <li key={item} className="flex gap-3 text-[16px] leading-relaxed text-ink-soft">
                  <span aria-hidden className="mt-[11px] h-[2px] w-4 shrink-0 bg-ink" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13px] text-muted sm:px-8">
          <span>Import des activités Strava et export vers Garmin, Zwift, Wahoo et Suunto : en cours de développement.</span>
          <ButtonLink href="/signup" variant="secondary" size="sm">
            Créer un compte
          </ButtonLink>
        </div>
      </footer>
    </div>
  );
}
