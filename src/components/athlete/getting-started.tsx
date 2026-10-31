import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";

export interface StartStep {
  key: string;
  done: boolean;
  title: string;
  text: string;
  action: string;
  href: string;
}

/**
 * Bien démarrer : l'essentiel pour que l'application serve dès le premier jour (seuils, montre,
 * première séance), chaque étape à un geste. Disparaît une fois tout fait.
 */
export function GettingStarted({ steps }: { steps: StartStep[] }) {
  const left = steps.filter((step) => !step.done).length;
  if (!left) return null;
  return (
    <section aria-labelledby="start-title" className="rounded-[14px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="start-title" className="heading text-[17px]">
          Bien démarrer
        </h2>
        <span className="figure text-[13px] text-muted">
          {steps.length - left} sur {steps.length}
        </span>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.key}>
            {step.done ? (
              <p className="flex items-center gap-3 px-1 py-1 text-[14px] text-muted">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                  <Check className="size-3.5" strokeWidth={2.6} aria-hidden />
                </span>
                {step.title} : c’est fait.
              </p>
            ) : (
              <Link href={step.href} className="group flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5 transition-colors hover:border-line-strong">
                <span aria-hidden className="size-6 shrink-0 rounded-full border-2 border-line-strong" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold text-ink">{step.title}</span>
                  <span className="block text-[13px] leading-snug text-muted">{step.text}</span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-ink-soft group-hover:text-ink">
                  {step.action}
                  <ChevronRight className="size-4" aria-hidden />
                </span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
