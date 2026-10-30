/**
 * Envoi direct vers Suunto, de bout en bout, contre un faux Suunto (données fictives) : connexion
 * OAuth depuis le profil, la séance publiée part seule comme guide, le coach voit l'état, l'athlète
 * renvoie à la main, l'annulation retire le guide, la déconnexion retire tout.
 */
import { expect, test } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";
import { FAKE_SUUNTO_URL } from "./global-setup";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = process.env.SUUNTO_CLIENT_ID === "suunto-app-id" && Boolean(serviceKey);
test.skip(!configured, "Application non reliée au faux Suunto (SUUNTO_CLIENT_ID=suunto-app-id, voir README).");

const day = isoDay(3);
const stamp = Date.now();
const title = `Seuil Suunto ${stamp}`;
let sessionId = "";

async function guidesOnSuunto(): Promise<{ id: string; name: string; guide: Record<string, unknown> }[]> {
  const response = await fetch(`${FAKE_SUUNTO_URL}/__control/guides`);
  return (await response.json()) as {
    id: string;
    name: string;
    guide: Record<string, unknown>;
  }[];
}

async function rest(pathName: string, init: RequestInit = {}) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${pathName}`, {
    ...init,
    headers: {
      apikey: serviceKey!,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathName} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const content = {
  schemaVersion: 1,
  segments: [
    {
      id: "bike",
      sport: "bike",
      steps: [
        {
          kind: "step",
          id: "wu",
          type: "warmup",
          length: { unit: "time", seconds: 600 },
          targets: [{ metric: "power", unit: "percent_ftp", min: 55, max: 70 }],
        },
        {
          kind: "repeat",
          id: "main",
          count: 3,
          steps: [
            {
              kind: "step",
              id: "on",
              type: "active",
              length: { unit: "time", seconds: 300 },
              targets: [
                { metric: "power", unit: "percent_ftp", min: 95, max: 100 },
                { metric: "cadence", unit: "rpm", min: 85, max: 95 },
              ],
            },
            {
              kind: "step",
              id: "off",
              type: "recovery",
              length: { unit: "time", seconds: 180 },
            },
          ],
        },
        { kind: "step", id: "cd", type: "cooldown", length: { unit: "open" } },
      ],
    },
  ],
};

test.beforeAll(async () => {
  const { coach, athlete } = accounts() as ReturnType<typeof accounts> & {
    coach: { token: string };
  };
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/planned_sessions`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      authorization: `Bearer ${coach.token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({
      athlete_id: athlete.id,
      scheduled_date: day,
      sport: "bike",
      title,
      content,
      state: "published",
      planned_duration_s: 2640,
    }),
  });
  if (!response.ok) throw new Error(`planned_sessions → ${response.status} ${await response.text()}`);
  sessionId = (await response.json())[0].id;
});

test("l'athlète relie son compte Suunto : la séance part seule sur la montre", async ({ browser }) => {
  const athlete = await signedIn(browser, "athlete");
  await athlete.goto("/athlete/profile#montre-suunto");
  await expect(athlete.getByRole("heading", { name: "Montre Suunto" })).toBeVisible();
  if (await athlete.getByRole("button", { name: "Déconnecter Suunto" }).isVisible()) {
    await athlete.getByRole("button", { name: "Déconnecter Suunto" }).click();
    await athlete.getByRole("dialog").getByRole("button", { name: "Déconnecter" }).click();
  }
  await athlete.getByRole("link", { name: "Connecter mon compte Suunto" }).click();
  await expect(athlete).toHaveURL(/suunto=connected/);
  await expect(athlete.getByText(/Suunto est connecté/)).toBeVisible();
  await expect(athlete.getByRole("button", { name: "Déconnecter Suunto" })).toBeVisible();

  // Les guides partent dans la file de jobs, juste après le retour de Suunto.
  await expect
    .poll(async () => (await guidesOnSuunto()).map((g) => g.name), {
      timeout: 20_000,
    })
    .toContain(title);
  const guide = (await guidesOnSuunto()).find((g) => g.name === title)!;
  expect(guide.guide).toMatchObject({
    owner: "TriCoach",
    usage: "workout",
    localDate: day,
    externalId: `${sessionId}:0`,
  });
  const steps = guide.guide.steps as {
    type: string;
    times?: number;
    fields?: { type: string; min?: number }[];
  }[];
  expect(steps[0].fields?.[0]).toMatchObject({ type: "targetPower", min: 138 }); // 55 % de 250 W (seuil de l'athlète e2e)
  expect(steps[1]).toMatchObject({ type: "repeat", times: 3 });

  await athlete.goto(`/athlete/calendar?view=week&date=${day}&session=${sessionId}`);
  const suunto = athlete.locator('[data-export-provider="suunto"]');
  await expect(suunto).toContainText("envoi direct sur la montre");
  await expect(suunto).toContainText("sur votre compte Suunto depuis le");
  await expect(suunto).toContainText("1 approximation"); // cadence écrite en texte
  await suunto.getByText("Ce que la montre ne montre pas tel quel").click();
  await expect(suunto).toContainText("Une seule cible avec jauge par étape");
  await athlete.context().close();
});

test("le coach voit l'état sans pouvoir envoyer ; l'athlète renvoie à la main après une modification", async ({ browser }) => {
  const coach = await signedIn(browser, "coach");
  const { athlete: who } = accounts();
  await coach.goto(`/coach/athletes/${who.id}?view=week&date=${day}&session=${sessionId}`);
  const row = coach.locator('[data-export-provider="suunto"]');
  await expect(row).toContainText("sur votre compte Suunto depuis le");
  await expect(row.getByRole("button", { name: /sur ma montre/ })).toHaveCount(0);
  await coach.context().close();

  await rest(`planned_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: `${title} v2` }),
  });
  const athlete = await signedIn(browser, "athlete");
  await athlete.goto(`/athlete/calendar?view=week&date=${day}&session=${sessionId}`);
  const suunto = athlete.locator('[data-export-provider="suunto"]');
  await suunto.getByRole("button", { name: "Renvoyer sur ma montre" }).click();
  await expect(suunto.getByRole("status")).toContainText("Séance envoyée sur votre compte Suunto");
  const guides = await guidesOnSuunto();
  expect(guides.filter((g) => String(g.guide.externalId) === `${sessionId}:0`)).toHaveLength(1);
  expect(guides.find((g) => String(g.guide.externalId) === `${sessionId}:0`)?.name).toBe(`${title} v2`);
  await athlete.context().close();
});

test("annulée, la séance quitte la montre ; déconnecter Suunto retire le reste", async ({ browser }) => {
  await rest(`planned_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "cancelled" }),
  });
  // La tâche quotidienne traite la file ; ici on l'appelle comme Vercel Cron.
  const cron = await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/cron/daily`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(cron.status).toBe(200);
  await expect.poll(async () => (await guidesOnSuunto()).some((g) => String(g.guide.externalId) === `${sessionId}:0`), { timeout: 20_000 }).toBe(false);

  await rest(`planned_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "published" }),
  });
  await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/cron/daily`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  await expect.poll(async () => (await guidesOnSuunto()).some((g) => String(g.guide.externalId) === `${sessionId}:0`), { timeout: 20_000 }).toBe(true);

  const athlete = await signedIn(browser, "athlete");
  await athlete.goto("/athlete/profile#montre-suunto");
  await athlete.getByRole("button", { name: "Déconnecter Suunto" }).click();
  await athlete.getByRole("dialog").getByRole("button", { name: "Déconnecter" }).click();
  await expect(athlete.getByText(/Compte Suunto déconnecté/)).toBeVisible();
  expect((await guidesOnSuunto()).some((g) => String(g.guide.externalId) === `${sessionId}:0`)).toBe(false);
  await expect(athlete.getByRole("link", { name: "Connecter mon compte Suunto" })).toBeVisible();
  await athlete.context().close();
});
