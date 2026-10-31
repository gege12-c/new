import { describe, expect, it } from "vitest";
import { normalizePlannedEvent, plannedWorkout } from "./planned";

/** Séance du calendrier intervals.icu, comme `GET /events?category=WORKOUT&resolve=true` la renvoie (fictive). */
const event = (extra: Record<string, unknown> = {}) => ({
  id: 81234,
  start_date_local: "2026-11-03T00:00:00",
  category: "WORKOUT",
  type: "Ride",
  name: "3x10 seuil",
  description: "Échauffement\n- 10m ramp 50-75%\n\n3x\n- 10m 90-95% 85-95rpm\n- 5m 55%\n\n- 10m 50%",
  moving_time: 4200,
  updated: "2026-10-31T15:02:11.000Z",
  ...extra,
});

describe("séances prévues dans intervals.icu", () => {
  it("reprend le déroulé lu par intervals.icu : rampes, répétitions, % FTP, cadence, types d'étape", () => {
    const outcome = normalizePlannedEvent(
      event({
        workout_doc: {
          target: "POWER",
          steps: [
            { text: "Échauffement", duration: 600, warmup: true, ramp: true, power: { start: 50, end: 75, units: "%ftp" }, _power: { start: 115, end: 172 } },
            {
              reps: 3,
              text: "Main set",
              steps: [
                { duration: 600, power: { start: 90, end: 95, units: "%ftp" }, cadence: { start: 85, end: 95, units: "rpm" } },
                { duration: 300, intensity: "recovery", power: { value: 55, units: "%ftp" } },
              ],
            },
            { duration: 600, cooldown: true, power: { value: 50, units: "%ftp" } },
          ],
        },
      }),
    );
    expect(outcome.kind).toBe("workout");
    if (outcome.kind !== "workout") return;
    const { fields } = outcome;
    expect(fields).toMatchObject({ external_id: "81234", scheduled_date: "2026-11-03", start_time: null, sport: "bike", title: "3x10 seuil", moving_s: 4200, import_notes: [] });
    expect(fields.external_updated_at).toBe("2026-10-31T15:02:11.000Z");
    // La description du coach reste entière.
    expect(fields.description).toContain("3x");
    const [warmup, repeat, cooldown] = fields.content.segments[0].steps;
    expect(warmup).toMatchObject({ kind: "step", type: "warmup", length: { unit: "time", seconds: 600 }, targets: [{ metric: "power", unit: "percent_ftp", min: 50, max: 75 }], label: "Échauffement" });
    expect(warmup.kind === "step" && warmup.notes).toContain("Progressif");
    expect(repeat).toMatchObject({ kind: "repeat", count: 3, label: "Main set" });
    if (repeat.kind !== "repeat") return;
    expect(repeat.steps[0]).toMatchObject({
      type: "active",
      targets: [
        { metric: "power", unit: "percent_ftp", min: 90, max: 95 },
        { metric: "cadence", unit: "rpm", min: 85, max: 95 },
      ],
    });
    expect(repeat.steps[1]).toMatchObject({ type: "recovery", targets: [{ metric: "power", unit: "percent_ftp", min: 55, max: 55 }] });
    expect(cooldown).toMatchObject({ type: "cooldown", length: { unit: "time", seconds: 600 } });
  });

  it("zones et % de l'allure seuil gardés ; unité inconnue : valeur absolue d'intervals.icu (m/s → allure), sinon notée", () => {
    const { workout, notes } = plannedWorkout(
      {
        steps: [
          { duration: 900, pace: { start: 1, end: 2, units: "pace_zone" } },
          { distance: 1000, pace: { start: 95, end: 100, units: "%pace" } },
          // Allure absolue : unité que TriCoach ne connaît pas, vitesse fournie par intervals.icu.
          { distance: 400, pace: { start: 4.3, end: 4.2, units: "mins/km" }, _pace: { start: 3.2, end: 3.4 } },
          // Zone de FC au-delà des 5 zones de TriCoach : bpm calculés par intervals.icu.
          { duration: 60, hr: { value: 6, units: "hr_zone" }, _hr: { start: 182, end: 190 } },
          // Ni unité connue, ni valeur absolue : rien n'est deviné.
          { duration: 120, hr: { value: 3, units: "mystery" } },
        ],
      },
      null,
      "run",
      null,
      null,
      null,
    );
    const steps = workout.segments[0].steps;
    expect(steps[0]).toMatchObject({ targets: [{ metric: "pace", unit: "zone", min: 1, max: 2 }] });
    expect(steps[1]).toMatchObject({ length: { unit: "distance", meters: 1000 }, targets: [{ metric: "pace", unit: "percent_threshold", min: 95, max: 100 }] });
    // 3,4 m/s = 4:54 /km (borne rapide), 3,2 m/s = 5:13 /km.
    expect(steps[2]).toMatchObject({ targets: [{ metric: "pace", unit: "sec_per_km", min: 294, max: 313 }] });
    expect(steps[3]).toMatchObject({ targets: [{ metric: "heart_rate", unit: "bpm", min: 182, max: 190 }] });
    expect(steps[4]).toMatchObject({ targets: [] });
    expect(notes).toEqual(["Une cible de fréquence cardiaque n'a pas pu être reprise (unité inconnue de TriCoach) : voir la description."]);
  });

  it("natation en distance, allure par 100 m ; deux cibles au plus par étape (la troisième est dite)", () => {
    const swim = plannedWorkout({ steps: [{ distance: 200, _pace: { start: 1.2, end: 1.25 }, pace: { value: 3, units: "??" } }] }, null, "swim", null, null, null);
    expect(swim.workout.segments[0].steps[0]).toMatchObject({ length: { unit: "distance", meters: 200 }, targets: [{ metric: "pace", unit: "sec_per_100m", min: 80, max: 83 }] });
    const bike = plannedWorkout(
      {
        steps: [
          { duration: 300, power: { value: 250, units: "w" }, hr: { start: 150, end: 160, units: "bpm" }, cadence: { value: 90, units: "rpm" } },
          { until_lap_press: true, freeride: true, text: "Retour au calme jusqu'à la maison" },
        ],
      },
      null,
      "bike",
      null,
      null,
      null,
    );
    const [effort, open] = bike.workout.segments[0].steps;
    expect(effort).toMatchObject({
      targets: [
        { metric: "power", unit: "watts", min: 250, max: 250 },
        { metric: "heart_rate", unit: "bpm", min: 150, max: 160 },
      ],
    });
    expect(effort.kind === "step" && effort.notes).toContain("cadence");
    expect(open).toMatchObject({ type: "cooldown", length: { unit: "open" }, targets: [] });
    expect(open.kind === "step" && open.notes).toContain("Libre");
  });

  it("sans déroulé : la description lue comme du texte, sinon une étape de la durée prévue", () => {
    const fromText = plannedWorkout(null, "Footing tranquille\n- 45m Z2 HR", "run", null, 2700, null);
    expect(fromText.workout.segments[0].steps[0]).toMatchObject({ length: { unit: "time", seconds: 2700 }, targets: [{ metric: "heart_rate", unit: "zone", min: 2, max: 2 }] });
    expect(fromText.notes).toEqual([]);
    const plain = plannedWorkout(null, "Sortie longue, à l'aise, ravitaillement toutes les 30 min.", "bike", null, 10_800, 90_000);
    expect(plain.workout.segments[0].steps).toEqual([{ kind: "step", id: "i1", type: "active", length: { unit: "time", seconds: 10_800 }, targets: [] }]);
    expect(plain.notes[0]).toContain("Pas de déroulé détaillé");
  });

  it("écarte les séances déposées par TriCoach, les notes, les séances cachées et les dates illisibles", () => {
    expect(normalizePlannedEvent(event({ external_id: "tricoach-0b1c-0" }))).toEqual({ kind: "skip", reason: "ours" });
    expect(normalizePlannedEvent(event({ category: "NOTE" }))).toEqual({ kind: "skip", reason: "not_workout" });
    expect(normalizePlannedEvent(event({ hide_from_athlete: true }))).toEqual({ kind: "skip", reason: "hidden" });
    expect(normalizePlannedEvent(event({ start_date_local: "demain" }))).toEqual({ kind: "skip", reason: "unreadable" });
    expect(normalizePlannedEvent({ name: "sans identifiant" })).toEqual({ kind: "skip", reason: "unreadable" });
  });

  it("discipline, heure et titre", () => {
    const at = (extra: Record<string, unknown>) => {
      const outcome = normalizePlannedEvent(event({ workout_doc: null, description: null, ...extra }));
      if (outcome.kind !== "workout") throw new Error("séance attendue");
      return outcome.fields;
    };
    expect(at({ type: "VirtualRide", start_date_local: "2026-11-03T18:30:00" })).toMatchObject({ sport: "bike", start_time: "18:30:00" });
    expect(at({ type: "OpenWaterSwim" }).sport).toBe("swim");
    expect(at({ type: "TrailRun" }).sport).toBe("run");
    expect(at({ type: "WeightTraining" }).sport).toBe("strength");
    expect(at({ type: "Yoga" }).sport).toBe("other");
    expect(at({ name: "  " }).title).toBe("Vélo");
  });
});
