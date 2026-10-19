/** Mise en forme française des durées, distances, allures et cibles. */
import type { Length, SegmentSport, Target, WorkoutNode } from "./schema";
import { STEP_TYPE_LABELS } from "./schema";

const nf = (maximumFractionDigits = 0) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits, minimumFractionDigits: 0 });

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  if (minutes === 60) return `${hours + 1} h`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, "0")}`;
}

/** Durée arrondie à la minute, pour les calendriers et les totaux : « 27 min », « 1 h 05 ». */
export function formatDurationShort(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

/** Heure locale « 07:30:00 » → « 7 h 30 », « 18:00 » → « 18 h ». */
export function formatTimeOfDay(time: string): string {
  const [h, m] = time.split(":");
  return m === "00" ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}

export function formatDistance(meters: number, sport?: SegmentSport): string {
  if (sport === "swim" || meters < 1000) return `${nf().format(Math.round(meters))} m`;
  return `${nf(meters < 10_000 ? 2 : 1).format(meters / 1000)} km`;
}

/** 275 → « 4:35 ». */
export function formatClock(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatPace(seconds: number, unit: "sec_per_km" | "sec_per_100m"): string {
  return `${formatClock(seconds)} ${unit === "sec_per_km" ? "/km" : "/100 m"}`;
}

const range = (min: number, max: number, format: (n: number) => string = (n) => nf(1).format(n)) =>
  min === max ? format(min) : `${format(min)}–${format(max)}`;

export function describeTarget(target: Target, sport?: SegmentSport): string {
  const { min, max } = target;
  switch (`${target.metric}.${target.unit}`) {
    case "power.watts":
      return `${range(min, max)} W`;
    case "power.percent_ftp":
      return `${range(min, max)} % FTP`;
    case "power.zone":
      return `${range(min, max, (n) => `Z${n}`)} puissance`;
    case "heart_rate.bpm":
      return `${range(min, max)} bpm`;
    case "heart_rate.percent_lthr":
      return `${range(min, max)} % FC seuil`;
    case "heart_rate.percent_max_hr":
      return `${range(min, max)} % FC max`;
    case "heart_rate.zone":
      return `${range(min, max, (n) => `Z${n}`)} FC`;
    case "pace.sec_per_km":
      return `${range(min, max, formatClock)} /km`;
    case "pace.sec_per_100m":
      return `${range(min, max, formatClock)} /100 m`;
    case "pace.percent_threshold":
      // Pourcentage de la vitesse au seuil (110 % = plus vite) : « vitesse », pour ne pas le lire comme une allure.
      return `${range(min, max)} % ${sport === "swim" ? "CSS" : "vitesse seuil"}`;
    case "pace.zone":
      return `${range(min, max, (n) => `Z${n}`)} allure`;
    case "speed.kmh":
      return `${range(min, max)} km/h`;
    case "cadence.rpm":
      return `${range(min, max)} rpm`;
    case "cadence.spm":
      return `${range(min, max)} pas/min`;
    case "rpe.scale":
      return `RPE ${range(min, max)}`;
    default:
      return `${min}–${max}`;
  }
}

export function describeLength(length: Length, sport?: SegmentSport): string {
  switch (length.unit) {
    case "time":
      return formatDuration(length.seconds);
    case "distance":
      return formatDistance(length.meters, sport);
    case "reps":
      return `${length.reps} répétitions`;
    case "open":
      return "durée libre";
  }
}

/** Résumé compact : « 15 min Échauffement · 4 × (5 min 95–100 % FTP / 2 min Récupération) ». */
export function summarizeNodes(nodes: WorkoutNode[], sport: SegmentSport): string {
  return nodes
    .map((node) => {
      if (node.kind === "repeat") {
        const inner = node.steps
          .map((child) => (child.kind === "repeat" ? summarizeNodes([child], sport) : summarizeStep(child, sport)))
          .join(" / ");
        return `${node.count} × (${inner})`;
      }
      return summarizeStep(node, sport);
    })
    .join(" · ");
}

/** « Échauffement 15 min à 55–70 % FTP » : le nom de l’étape d’abord, puis sa mesure et sa cible. */
function summarizeStep(step: Extract<WorkoutNode, { kind: "step" }>, sport: SegmentSport): string {
  const length = describeLength(step.length, sport);
  const first = step.targets[0];
  const target = first ? ` ${first.unit === "zone" ? "en" : "à"} ${describeTarget(first, sport)}` : "";
  const label = step.label ?? (step.type === "active" ? "" : STEP_TYPE_LABELS[step.type]);
  const sendOff = step.sendOffSeconds ? `, départ ${formatClock(step.sendOffSeconds)}` : "";
  return [label, length + target + sendOff].filter(Boolean).join(" ");
}
