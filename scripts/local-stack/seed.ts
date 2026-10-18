/**
 * Données de démonstration pour la pile locale : un coach, trois athlètes, leurs seuils,
 * leurs compétitions, cinq semaines de séances et une bibliothèque de modèles.
 * Toutes les écritures passent par l'API, sous l'identité de chaque utilisateur (RLS comprise).
 *
 *   npx tsx scripts/local-stack/seed.ts
 *
 * Mot de passe de tous les comptes : voir DEMO_PASSWORD. Données fictives, jamais en production.
 */
import { computeTotals } from "@/lib/workout/compute";
import { WorkoutSchema } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { DEMO, type DemoSession } from "./demo-workouts";

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!KEY) throw new Error("Chargez d'abord .env.local-stack (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");
export const DEMO_PASSWORD = "Demo-tricoach-2026";

interface Account {
  id: string;
  token: string;
  email: string;
}

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      apikey: KEY!,
      authorization: `Bearer ${init.token ?? KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status} ${text}`);
  return body;
}

async function signUp(email: string, name: string, coach = false): Promise<Account> {
  const body = await call("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: DEMO_PASSWORD, data: { display_name: name, is_coach: coach, timezone: "Europe/Paris" } }),
  });
  return { id: body.user.id, token: body.access_token, email };
}

const rest = (account: Account, path: string, method: string, body?: unknown) =>
  call(`/rest/v1/${path}`, { method, token: account.token, body: body === undefined ? undefined : JSON.stringify(body) });

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Lundi de la semaine courante (Europe/Paris), en date locale. */
function currentMonday(): Date {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

type Slot = { day: number; key: keyof typeof DEMO; time?: string; state?: "draft" | "published" | "cancelled" };

/** Semaine type d'une triathlète longue distance (0 = lundi). */
const WEEK_A: Slot[] = [
  { day: 0, key: "swimTechnique", time: "12:15" },
  { day: 1, key: "bikeThreshold", time: "18:30" },
  { day: 1, key: "runEasy", time: "07:00" },
  { day: 2, key: "runThreshold", time: "18:45" },
  { day: 2, key: "swimCss", time: "12:15" },
  { day: 3, key: "bikeSweetSpot", time: "18:30" },
  { day: 4, key: "strength" },
  { day: 5, key: "bikeLong", time: "09:00" },
  { day: 6, key: "runLong", time: "09:30" },
];

const WEEK_B: Slot[] = [
  { day: 0, key: "swimEndurance", time: "12:15" },
  { day: 1, key: "bikeVo2", time: "18:30" },
  { day: 2, key: "runIntervals", time: "18:45" },
  { day: 2, key: "swimTechnique", time: "07:00" },
  { day: 3, key: "bikeEndurance", time: "18:30" },
  { day: 4, key: "swimCss", time: "12:15" },
  { day: 5, key: "brick", time: "09:00" },
  { day: 6, key: "runLong", time: "09:30" },
];

function sessionRow(athleteId: string, date: string, slot: Slot, demo: DemoSession, thresholds: AthleteThresholds) {
  const content = WorkoutSchema.parse(demo.content);
  const totals = computeTotals(content, thresholds);
  return {
    athlete_id: athleteId,
    scheduled_date: date,
    start_time: slot.time ?? null,
    sport: demo.sport,
    title: demo.title,
    objective: demo.objective,
    description: demo.description ?? null,
    nutrition_notes: demo.nutrition ?? null,
    content,
    planned_duration_s: totals.duration.value ? Math.round(totals.duration.value) : null,
    planned_distance_m: totals.distance.value ? Math.round(totals.distance.value) : null,
    state: slot.state ?? "published",
  };
}

async function link(coach: Account, athlete: Account) {
  const [invitation] = await rest(coach, "rpc/create_invitation", "POST", { p_email: athlete.email, p_valid_hours: 168 });
  await rest(athlete, "rpc/accept_invitation", "POST", { p_token: invitation.token });
}

async function main() {
  const coach = await signUp("coach@tricoach.local", "Camille Laurent", true);
  const lea = await signUp("lea@tricoach.local", "Léa Martin");
  const hugo = await signUp("hugo@tricoach.local", "Hugo Bernard");
  const ines = await signUp("ines@tricoach.local", "Inès Moreau");
  for (const athlete of [lea, hugo, ines]) await link(coach, athlete);

  const monday = currentMonday();
  const since = isoDate(addDays(monday, -70));

  const profiles = [
    { who: lea, goal: "Finir l'Ironman 70.3 d'Aix-en-Provence en moins de 5 h 30", level: "intermediate", hours: 10 },
    { who: hugo, goal: "Podium de catégorie sur triathlon distance olympique", level: "advanced", hours: 12 },
    { who: ines, goal: "Premier triathlon sprint au printemps", level: "beginner", hours: 5 },
  ];
  for (const p of profiles) {
    await rest(p.who, `athlete_profiles?user_id=eq.${p.who.id}`, "PATCH", {
      main_goal: p.goal,
      experience_level: p.level,
      weekly_hours_target: p.hours,
    });
  }

  const thresholds: Record<string, { rows: [string, string, number][]; athlete: AthleteThresholds }> = {
    [lea.id]: {
      rows: [
        ["bike", "ftp_w", 228],
        ["bike", "lthr_bpm", 162],
        ["run", "threshold_pace_s_per_km", 275],
        ["run", "lthr_bpm", 171],
        ["swim", "css_s_per_100m", 102],
        ["general", "max_hr_bpm", 188],
        ["general", "weight_kg", 61],
      ],
      athlete: { bike: { ftpW: 228, lthrBpm: 162 }, run: { thresholdPaceSPerKm: 275, lthrBpm: 171 }, swim: { cssSPer100m: 102 } },
    },
    [hugo.id]: {
      rows: [
        ["bike", "ftp_w", 291],
        ["run", "threshold_pace_s_per_km", 236],
        ["swim", "css_s_per_100m", 86],
      ],
      athlete: { bike: { ftpW: 291 }, run: { thresholdPaceSPerKm: 236 }, swim: { cssSPer100m: 86 } },
    },
    [ines.id]: {
      rows: [
        ["bike", "ftp_w", 168],
        ["run", "threshold_pace_s_per_km", 330],
      ],
      athlete: { bike: { ftpW: 168 }, run: { thresholdPaceSPerKm: 330 } },
    },
  };
  for (const athlete of [lea, hugo, ines]) {
    const { rows } = thresholds[athlete.id];
    await rest(
      athlete,
      "athlete_thresholds",
      "POST",
      rows.map(([sport, metric, value]) => ({ athlete_id: athlete.id, sport, metric, value, effective_from: since })),
    );
  }
  // Une FTP plus ancienne, pour l'historique des seuils.
  await rest(lea, "athlete_thresholds", "POST", [
    { athlete_id: lea.id, sport: "bike", metric: "ftp_w", value: 214, effective_from: isoDate(addDays(monday, -160)) },
  ]);

  await rest(lea, "athlete_events", "POST", [
    {
      athlete_id: lea.id,
      name: "Ironman 70.3 Aix-en-Provence",
      event_date: isoDate(addDays(monday, 7 * 30 + 6)),
      priority: "A",
      sport: "triathlon",
      distance_label: "70.3",
      location: "Aix-en-Provence",
    },
    {
      athlete_id: lea.id,
      name: "Triathlon M de Gérardmer",
      event_date: isoDate(addDays(monday, 7 * 45 + 5)),
      priority: "B",
      sport: "triathlon",
      distance_label: "M",
      location: "Gérardmer",
    },
  ]);
  await rest(hugo, "athlete_events", "POST", [
    {
      athlete_id: hugo.id,
      name: "Triathlon de Paris",
      event_date: isoDate(addDays(monday, 7 * 37 + 6)),
      priority: "A",
      sport: "triathlon",
      distance_label: "M",
      location: "Paris",
    },
  ]);

  // Léa : deux semaines passées, la semaine en cours, la suivante publiée, la d'après en préparation.
  const leaRows = [];
  for (let week = -2; week <= 2; week += 1) {
    const plan = week % 2 === 0 ? WEEK_A : WEEK_B;
    for (const slot of plan) {
      let state: Slot["state"] = "published";
      if (week === 2 && slot.day >= 2) state = "draft";
      if (week === -1 && slot.day === 4) state = "cancelled";
      const date = isoDate(addDays(monday, week * 7 + slot.day));
      leaRows.push(sessionRow(lea.id, date, { ...slot, state }, DEMO[slot.key](), thresholds[lea.id].athlete));
    }
  }
  const leaSessions = await rest(coach, "planned_sessions", "POST", leaRows);

  const hugoRows = [];
  for (let week = -1; week <= 1; week += 1) {
    for (const slot of WEEK_B.filter((s) => s.day !== 4)) {
      const date = isoDate(addDays(monday, week * 7 + slot.day));
      hugoRows.push(sessionRow(hugo.id, date, slot, DEMO[slot.key](), thresholds[hugo.id].athlete));
    }
  }
  await rest(coach, "planned_sessions", "POST", hugoRows);

  const inesRows = [0, 2, 5].map((day) =>
    sessionRow(
      ines.id,
      isoDate(addDays(monday, day)),
      { day, key: day === 0 ? "swimTechnique" : day === 2 ? "runEasy" : "bikeEndurance", state: day === 5 ? "draft" : "published" },
      DEMO[day === 0 ? "swimTechnique" : day === 2 ? "runEasy" : "bikeEndurance"](),
      thresholds[ines.id].athlete,
    ),
  );
  await rest(coach, "planned_sessions", "POST", inesRows);

  // Commentaires sur les séances récentes de Léa.
  const lastWeek = leaSessions.filter(
    (s: { scheduled_date: string; state: string }) =>
      s.state === "published" && s.scheduled_date < isoDate(monday) && s.scheduled_date >= isoDate(addDays(monday, -7)),
  );
  const vo2 = lastWeek.find((s: { title: string }) => s.title.startsWith("PMA"));
  if (vo2) {
    await rest(lea, "session_comments", "POST", { session_id: vo2.id, body: "Dernier bloc très dur, j'ai fini à 112 % au lieu de 115." });
    await rest(coach, "session_comments", "POST", {
      session_id: vo2.id,
      body: "Normal en fin de bloc de charge. On garde la même plage la semaine prochaine.",
    });
    await rest(coach, "session_comments", "POST", {
      session_id: vo2.id,
      visibility: "coach_private",
      body: "Surveiller la fatigue : deux séances difficiles écourtées en dix jours.",
    });
  }

  // Bibliothèque du coach.
  const templates = ["bikeThreshold", "bikeVo2", "bikeSweetSpot", "runThreshold", "runIntervals", "swimCss", "swimTechnique", "brick", "strength"];
  await rest(
    coach,
    "workout_templates",
    "POST",
    templates.map((key) => {
      const demo = DEMO[key]();
      const content = WorkoutSchema.parse(demo.content);
      const totals = computeTotals(content);
      return {
        name: demo.title,
        sport: demo.sport,
        objective: demo.objective,
        description: demo.description ?? null,
        content,
        planned_duration_s: totals.duration.status === "exact" ? Math.round(totals.duration.value) : null,
        tags: [],
      };
    }),
  );

  console.log(`Données de démonstration créées. Comptes : coach@, lea@, hugo@, ines@tricoach.local — mot de passe ${DEMO_PASSWORD}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
