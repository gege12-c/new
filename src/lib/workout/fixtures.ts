/** Séances d'exemple, utilisées par les tests et la documentation. */
import type { WorkoutInput } from "./schema";

/** Vélo : 15 min d'échauffement, 4 × (8 min à 95–100 % FTP / 3 min récup), 10 min retour au calme. */
export const bikeThreshold: WorkoutInput = {
  schemaVersion: 1,
  segments: [
    {
      id: "seg-bike",
      sport: "bike",
      title: "Seuil 4 × 8 min",
      steps: [
        {
          kind: "step",
          id: "wu",
          type: "warmup",
          length: { unit: "time", seconds: 900 },
          targets: [{ metric: "power", unit: "percent_ftp", min: 55, max: 70 }],
        },
        {
          kind: "repeat",
          id: "main",
          count: 4,
          steps: [
            {
              kind: "step",
              id: "work",
              type: "active",
              length: { unit: "time", seconds: 480 },
              targets: [
                { metric: "power", unit: "percent_ftp", min: 95, max: 100 },
                { metric: "cadence", unit: "rpm", min: 85, max: 95 },
              ],
            },
            {
              kind: "step",
              id: "rec",
              type: "recovery",
              length: { unit: "time", seconds: 180 },
              targets: [{ metric: "power", unit: "zone", min: 1, max: 1 }],
            },
          ],
        },
        {
          kind: "step",
          id: "cd",
          type: "cooldown",
          length: { unit: "time", seconds: 600 },
          targets: [{ metric: "power", unit: "percent_ftp", min: 50, max: 60 }],
        },
      ],
    },
  ],
};

/** Natation : 400 m souple, 8 × 100 m départ 1:50 à 98–102 % CSS, 200 m pull-buoy. */
export const swimCss: WorkoutInput = {
  schemaVersion: 1,
  segments: [
    {
      id: "seg-swim",
      sport: "swim",
      steps: [
        { kind: "step", id: "s-wu", type: "warmup", length: { unit: "distance", meters: 400 } },
        {
          kind: "repeat",
          id: "s-main",
          count: 8,
          steps: [
            {
              kind: "step",
              id: "s-100",
              type: "active",
              length: { unit: "distance", meters: 100 },
              sendOffSeconds: 110,
              targets: [{ metric: "pace", unit: "percent_threshold", min: 98, max: 102 }],
            },
          ],
        },
        {
          kind: "step",
          id: "s-pull",
          type: "cooldown",
          length: { unit: "distance", meters: 200 },
          equipment: ["pull_buoy"],
        },
      ],
    },
  ],
};

/** Enchaînement : 60 min vélo en Z2, transition 2 min, 20 min course à 4:30–4:40 /km. */
export const brick: WorkoutInput = {
  schemaVersion: 1,
  segments: [
    {
      id: "seg-b",
      sport: "bike",
      steps: [
        {
          kind: "step",
          id: "b1",
          type: "active",
          length: { unit: "time", seconds: 3600 },
          targets: [{ metric: "power", unit: "zone", min: 2, max: 2 }],
        },
      ],
    },
    {
      id: "seg-r",
      sport: "run",
      steps: [
        { kind: "step", id: "t2", type: "transition", length: { unit: "time", seconds: 120 } },
        {
          kind: "step",
          id: "r1",
          type: "active",
          length: { unit: "time", seconds: 1200 },
          targets: [{ metric: "pace", unit: "sec_per_km", min: 270, max: 280 }],
        },
      ],
    },
  ],
};
