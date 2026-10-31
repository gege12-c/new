/**
 * Condition physique, fatigue et forme : modèle impulsion-réponse de Banister, sous la forme
 * popularisée par TrainingPeaks (CTL, ATL, TSB) et reprise par Intervals.icu. Méthode décrite
 * dans docs/FITNESS.md.
 *
 * Chaque jour a une charge (en points de TSS) :
 * - passé : fichiers FIT importés (puissance, allure ou FC rapportées aux seuils) et retours de
 *   séance (« faite », avec l'effort ressenti) — jamais les activités Strava (accord API Strava,
 *   pas d'analyse ni d'agrégation de ses données) ;
 * - futur : séances prévues publiées, d'après leur structure et les seuils de l'athlète.
 * Condition = moyenne exponentielle de la charge sur 42 jours, fatigue = sur 7 jours,
 * forme = condition − fatigue. Ce qui ne peut pas être évalué n'est pas compté, et le dit.
 */
import { addDays } from "@/lib/planning/dates";
import { expandWorkout, intensityPercent, rpePercent, stepQuantities } from "@/lib/workout/compute";
import type { Workout } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;
/** Fenêtre affichée par défaut : 13 semaines passées ; l'historique lu remonte à un an. */
export const HISTORY_DAYS = 91;
export const MAX_HISTORY_DAYS = 365;
/** Prévision : jusqu'à la dernière séance prévue ou la prochaine course, six mois au plus. */
export const PROJECTION_DAYS = 182;
/** Historique lu en plus avant la fenêtre, pour que la condition n'y parte pas de zéro. */
export const WARMUP_DAYS = 120;

/** Intensité (rapport au seuil) bornée : un capteur aberrant ne fait pas exploser la charge. */
const clampIntensity = (value: number) => Math.min(Math.max(value, 0.3), 1.5);

/** Charge d'un effort : durée en heures × intensité² × 100 (cube pour la natation, comme le sTSS). */
export function tss(seconds: number, intensity: number, exponent: 2 | 3 = 2): number {
  return (seconds / 3600) * clampIntensity(intensity) ** exponent * 100;
}

export interface LoadActivity {
  id: string;
  /** Nom de l'activité (détail du jour). */
  name?: string | null;
  sport: string;
  local_date: string;
  moving_s: number | null;
  elapsed_s: number | null;
  avg_power: number | null;
  weighted_power: number | null;
  avg_hr: number | null;
  avg_speed_mps: number | null;
}

export type LoadMethod = "power" | "pace" | "swim" | "heart_rate" | "rpe" | "plan";

export interface LoadEstimate {
  load: number;
  method: LoadMethod;
  /** Puissance moyenne faute de puissance normalisée, FC moyenne, ressenti ou prévu : une estimation. */
  estimated: boolean;
}

/** Charge d'une activité d'après ses mesures et les seuils du jour, ou null si rien n'est exploitable. */
export function activityLoad(activity: LoadActivity, thresholds?: AthleteThresholds): LoadEstimate | null {
  const seconds = activity.moving_s ?? activity.elapsed_s;
  if (!seconds) return null;
  const ftp = thresholds?.bike?.ftpW;
  const power = activity.weighted_power ?? activity.avg_power;
  if (activity.sport === "bike" && ftp && power) {
    return { load: tss(seconds, power / ftp), method: "power", estimated: activity.weighted_power === null };
  }
  const speed = activity.avg_speed_mps;
  const pace = thresholds?.run?.thresholdPaceSPerKm;
  if (activity.sport === "run" && pace && speed) {
    return { load: tss(seconds, speed / (1000 / pace)), method: "pace", estimated: true };
  }
  const css = thresholds?.swim?.cssSPer100m;
  if (activity.sport === "swim" && css && speed) {
    return { load: tss(seconds, speed / (100 / css), 3), method: "swim", estimated: true };
  }
  const lthr = activity.sport === "run" ? (thresholds?.run?.lthrBpm ?? thresholds?.bike?.lthrBpm) : (thresholds?.bike?.lthrBpm ?? thresholds?.run?.lthrBpm);
  if (activity.sport !== "swim" && lthr && activity.avg_hr) {
    return { load: tss(seconds, activity.avg_hr / lthr), method: "heart_rate", estimated: true };
  }
  return null;
}

export interface PlannedLoad {
  load: number;
  /** Durée (s) des étapes dont l'intensité n'est pas exprimable : leur charge n'est pas comptée. */
  unknownSeconds: number;
  /** Durée totale prévue (s), étapes sans intensité comprises. */
  seconds: number;
}

/** Charge prévue d'une séance, étape par étape : durée × intensité (% FTP, % seuil, zones, RPE…). */
export function plannedLoad(workout: Workout, thresholds?: AthleteThresholds): PlannedLoad {
  let load = 0;
  let unknownSeconds = 0;
  let seconds = 0;
  for (const flat of expandWorkout(workout)) {
    const duration = stepQuantities(flat.step, flat.sport, thresholds).duration.value;
    if (!duration) continue;
    seconds += duration;
    if (flat.step.type === "rest") continue;
    const percent = intensityPercent(flat.step, flat.sport, thresholds);
    if (percent === null) {
      unknownSeconds += duration;
      continue;
    }
    load += tss(duration, percent / 100, flat.sport === "swim" ? 3 : 2);
  }
  return { load, unknownSeconds, seconds };
}

/** Charge d'une séance faite d'après le retour de l'athlète : durée × intensité de son ressenti. */
export function feedbackLoad(seconds: number, rpe: number): number {
  return tss(seconds, rpePercent(rpe) / 100);
}

export interface FitnessSession {
  id: string;
  scheduled_date: string;
  state: string;
  content: Workout;
  title?: string;
  sport?: string;
}

/** Une charge comptée (ou prévue), pour le détail d'un jour et la simulation. */
export interface LoadItem {
  /** Activité faite, séance déclarée faite (retour de l'athlète), séance prévue. */
  kind: "activity" | "feedback" | "planned";
  /** Activité ou séance. */
  id: string;
  date: string;
  title: string;
  sport: string;
  load: number;
  method: LoadMethod;
  /** Séance prévue encore en brouillon : comptée seulement si la simulation l'inclut. */
  draft?: boolean;
}

export interface FitnessCompletion {
  session_id: string;
  status: "done" | "partial" | "skipped";
  rpe: number | null;
}

export interface FitnessInputs {
  today: string;
  sessions: FitnessSession[];
  /** Fichiers FIT seulement. */
  activities: LoadActivity[];
  /** Activité FIT → séance à laquelle elle est rattachée. */
  matches: Map<string, string>;
  completions: Map<string, FitnessCompletion>;
  thresholdsOn: (date: string) => AthleteThresholds | undefined;
}

export interface FitnessCoverage {
  /** Fichiers FIT comptés. */
  fit: number;
  /** Séances comptées d'après le retour de l'athlète (sans fichier FIT). */
  feedback: number;
  /** Séances prévues comptées dans la prévision. */
  planned: number;
  /** Fichiers FIT sans mesure exploitable (pas de puissance, d'allure ni de FC rapportable à un seuil, pas de ressenti). */
  fitWithoutMeasure: number;
  /** Séances « faite » ou « en partie » dont la charge ne peut pas être évaluée. */
  feedbackWithoutMeasure: number;
  /** Séances prévues dont une partie n'a pas d'intensité exprimable (non comptée). */
  plannedPartly: number;
}

/** Charge de chaque jour (date locale) : réelle jusqu'à aujourd'hui, prévue ensuite. */
export function dailyLoads(inputs: FitnessInputs): {
  actual: Map<string, number>;
  planned: Map<string, number>;
  coverage: FitnessCoverage;
  /** Charges comptées et prévues, une par activité ou séance (brouillons à venir compris, marqués). */
  items: LoadItem[];
} {
  const { today, sessions, activities, matches, completions, thresholdsOn } = inputs;
  const actual = new Map<string, number>();
  const planned = new Map<string, number>();
  const items: LoadItem[] = [];
  const add = (map: Map<string, number>, date: string, load: number) => map.set(date, (map.get(date) ?? 0) + load);
  const sessionTitle = (session: FitnessSession) => session.title ?? "Séance";
  const sessionSport = (session: FitnessSession) => session.sport ?? session.content.segments[0]?.sport ?? "other";
  const coverage: FitnessCoverage = { fit: 0, feedback: 0, planned: 0, fitWithoutMeasure: 0, feedbackWithoutMeasure: 0, plannedPartly: 0 };
  const sessionsWithFit = new Set<string>();

  for (const activity of activities) {
    if (activity.local_date > today) continue;
    const sessionId = matches.get(activity.id);
    if (sessionId) sessionsWithFit.add(sessionId);
    const measured = activityLoad(activity, thresholdsOn(activity.local_date));
    const activityItem = (load: number, method: LoadMethod): LoadItem => ({
      kind: "activity",
      id: activity.id,
      date: activity.local_date,
      title: activity.name ?? "",
      sport: activity.sport,
      load,
      method,
    });
    if (measured) {
      add(actual, activity.local_date, measured.load);
      items.push(activityItem(measured.load, measured.method));
      coverage.fit += 1;
      continue;
    }
    // Sans mesure exploitable : le ressenti donné pour la séance rattachée, sur la durée du fichier.
    const completion = sessionId ? completions.get(sessionId) : undefined;
    const seconds = activity.moving_s ?? activity.elapsed_s;
    if (completion?.rpe && seconds && completion.status !== "skipped") {
      const load = feedbackLoad(seconds, completion.rpe);
      add(actual, activity.local_date, load);
      items.push(activityItem(load, "rpe"));
      coverage.fit += 1;
    } else {
      coverage.fitWithoutMeasure += 1;
    }
  }

  for (const session of sessions) {
    const date = session.scheduled_date;
    // Brouillons à venir : seulement pour la simulation, jamais dans la prévision par défaut.
    if (session.state === "draft" && date >= today) {
      const plan = plannedLoad(session.content, thresholdsOn(date));
      if (plan.load > 0) items.push({ kind: "planned", id: session.id, date, title: sessionTitle(session), sport: sessionSport(session), load: plan.load, method: "plan", draft: true });
      continue;
    }
    if (session.state !== "published") continue;
    const completion = completions.get(session.id);
    const isPast = date < today || (date === today && completion !== undefined);
    if (isPast) {
      if (sessionsWithFit.has(session.id) || !completion || completion.status === "skipped") continue;
      const thresholds = thresholdsOn(date);
      const plan = plannedLoad(session.content, thresholds);
      if (completion.status === "partial") {
        // « En partie » : la part faite n'est pas connue, rien n'est supposé.
        coverage.feedbackWithoutMeasure += 1;
        continue;
      }
      if (completion.rpe && plan.seconds) {
        const load = feedbackLoad(plan.seconds, completion.rpe);
        add(actual, date, load);
        items.push({ kind: "feedback", id: session.id, date, title: sessionTitle(session), sport: sessionSport(session), load, method: "rpe" });
        coverage.feedback += 1;
      } else if (plan.load > 0 && plan.unknownSeconds === 0) {
        add(actual, date, plan.load);
        items.push({ kind: "feedback", id: session.id, date, title: sessionTitle(session), sport: sessionSport(session), load: plan.load, method: "plan" });
        coverage.feedback += 1;
      } else {
        coverage.feedbackWithoutMeasure += 1;
      }
      continue;
    }
    // Prévision : séances d'aujourd'hui sans retour ni fichier FIT, et à venir.
    if (sessionsWithFit.has(session.id)) continue;
    const plan = plannedLoad(session.content, thresholdsOn(date));
    if (plan.load > 0) {
      add(planned, date, plan.load);
      items.push({ kind: "planned", id: session.id, date, title: sessionTitle(session), sport: sessionSport(session), load: plan.load, method: "plan" });
      coverage.planned += 1;
    }
    if (plan.unknownSeconds > 0) coverage.plannedPartly += 1;
  }
  return { actual, planned, coverage, items };
}

export interface FitnessPoint {
  date: string;
  /** Charge du jour (TSS). */
  load: number;
  fitness: number;
  fatigue: number;
  form: number;
  /** Jour de prévision : la charge vient des séances prévues. */
  projected: boolean;
}

/**
 * Condition, fatigue et forme jour par jour de `start` à `end`. Moyennes exponentielles
 * (coefficients 1/42 et 1/7, comme TrainingPeaks), à partir de zéro au début de l'historique.
 */
export function fitnessSeries(actual: Map<string, number>, planned: Map<string, number>, start: string, end: string, today: string): FitnessPoint[] {
  const points: FitnessPoint[] = [];
  let fitness = 0;
  let fatigue = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    // Aujourd'hui : ce qui est déjà fait, plus ce qui reste prévu.
    const load = date < today ? (actual.get(date) ?? 0) : date > today ? (planned.get(date) ?? 0) : (actual.get(date) ?? 0) + (planned.get(date) ?? 0);
    const projected = date > today || (date === today && !actual.has(date));
    fitness += (load - fitness) / FITNESS_DAYS;
    fatigue += (load - fatigue) / FATIGUE_DAYS;
    points.push({ date, load, fitness, fatigue, form: fitness - fatigue, projected });
  }
  return points;
}

export interface FitnessState {
  fitness: number;
  fatigue: number;
}

/** Ce qu'il faut pour simuler la suite : l'état de la veille et les charges d'aujourd'hui à l'horizon. */
export interface FitnessModel {
  today: string;
  /** Condition et fatigue à la fin de la veille. */
  start: FitnessState;
  /** Charge déjà faite aujourd'hui. */
  todayActual: number;
  /** Séances prévues d'aujourd'hui à l'horizon (publiées, et brouillons marqués). */
  planned: LoadItem[];
  horizon: string;
}

export interface Scenario {
  /** Compter aussi les brouillons à venir. */
  includeDrafts: boolean;
  /** Séances retirées de la simulation (identifiants). */
  excluded: ReadonlySet<string>;
}

export const PUBLISHED_PLAN: Scenario = { includeDrafts: false, excluded: new Set() };

export const countsIn = (item: LoadItem, scenario: Scenario) => !scenario.excluded.has(item.id) && (!item.draft || scenario.includeDrafts);

/**
 * Condition, fatigue et forme d'aujourd'hui à l'horizon selon un scénario : ce qui est fait
 * aujourd'hui, plus les séances prévues comptées. Après la dernière séance comptée, la prévision
 * suppose le repos (`afterPlan`).
 */
export function simulate(model: FitnessModel, scenario: Scenario): (FitnessPoint & { afterPlan: boolean })[] {
  const loads = new Map<string, number>();
  let planEnd = "";
  for (const item of model.planned) {
    if (!countsIn(item, scenario)) continue;
    loads.set(item.date, (loads.get(item.date) ?? 0) + item.load);
    if (item.date > planEnd) planEnd = item.date;
  }
  const points: (FitnessPoint & { afterPlan: boolean })[] = [];
  let { fitness, fatigue } = model.start;
  for (let date = model.today; date <= model.horizon; date = addDays(date, 1)) {
    const planned = loads.get(date) ?? 0;
    const load = (date === model.today ? model.todayActual : 0) + planned;
    fitness += (load - fitness) / FITNESS_DAYS;
    fatigue += (load - fatigue) / FATIGUE_DAYS;
    points.push({
      date,
      load,
      fitness,
      fatigue,
      form: fitness - fatigue,
      projected: date > model.today || model.todayActual === 0,
      afterPlan: date > model.today && date > planEnd,
    });
  }
  return points;
}

/** Forme au départ d'une course : celle de la veille au soir (la charge de la course n'y entre pas). */
export function formOnRaceMorning(points: Pick<FitnessPoint, "date" | "form">[], raceDate: string): number | null {
  const eve = points.find((p) => p.date === addDays(raceDate, -1));
  return eve ? eve.form : null;
}

/** Variation de la condition sur les 7 jours qui précèdent `date` (null sans recul suffisant). */
export function weeklyRamp(points: Pick<FitnessPoint, "date" | "fitness">[], date: string): number | null {
  const now = points.find((p) => p.date === date);
  const before = points.find((p) => p.date === addDays(date, -7));
  return now && before ? now.fitness - before.fitness : null;
}

/** Zones de forme (Joe Friel, reprises par Intervals.icu). */
export const FORM_ZONES = [
  { key: "transition", label: "Transition", min: 20, hint: "Très reposé : la condition baisse si cela dure." },
  { key: "fresh", label: "Fraîcheur", min: 5, hint: "Frais et en forme : prêt pour une course." },
  { key: "grey", label: "Zone grise", min: -10, hint: "Charge d'entretien : peu de progrès." },
  { key: "optimal", label: "Zone optimale", min: -30, hint: "La charge fait progresser." },
  { key: "risk", label: "Risque élevé", min: -Infinity, hint: "Fatigue forte : risque de surentraînement si cela dure." },
] as const;

export type FormZoneKey = (typeof FORM_ZONES)[number]["key"];

export function formZone(form: number): (typeof FORM_ZONES)[number] {
  return FORM_ZONES.find((zone) => form >= zone.min) ?? FORM_ZONES[FORM_ZONES.length - 1];
}

/** Début de l'historique lu : un an affichable, plus la mise en route du calcul. */
export function historyStart(today: string): string {
  return addDays(today, -(MAX_HISTORY_DAYS + WARMUP_DAYS));
}
