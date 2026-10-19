/**
 * Montre Garmin, côté serveur, en jouant le rôle de l'application Connect IQ : la montre demande
 * un code, l'athlète le saisit dans son profil, la montre reçoit son jeton puis ses séances des
 * 7 prochains jours et le fichier FIT de séance (décodé par le SDK FIT officiel) ; dissociée, elle
 * n'a plus accès à rien.
 */
import { Decoder, Stream } from "@garmin/fitsdk";
import { expect, test } from "@playwright/test";
import { accounts, addDays, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

async function publishSession(date: string, title: string) {
  const { coach, athlete } = accounts() as ReturnType<typeof accounts> & { coach: { token: string } };
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
      scheduled_date: date,
      sport: "run",
      title,
      state: "published",
      planned_duration_s: 2400,
      content: {
        schemaVersion: 1,
        segments: [
          {
            id: "run",
            sport: "run",
            steps: [
              { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 600 }, targets: [{ metric: "rpe", unit: "scale", min: 3, max: 4 }] },
              { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 1200 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 270, max: 285 }] },
              { kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 600 } },
            ],
          },
        ],
      },
    }),
  });
  if (!response.ok) throw new Error(`séance de test : ${response.status} ${await response.text()}`);
  return (await response.json())[0].id as string;
}

test("associer une montre Garmin, lui servir ses séances, puis la dissocier", async ({ browser, request }) => {
  const stamp = Date.now();
  const soon = await publishSession(addDays(isoDay(0), 1), `Footing montre ${stamp}`);
  const later = await publishSession(addDays(isoDay(0), 10), `Trop loin ${stamp}`);

  // La montre demande un code.
  const paired = await (await request.post("/api/watch/pair", { data: { device: "Forerunner 965" } })).json();
  expect(paired).toMatchObject({ status: "ok", interval: 5 });
  expect(paired.display).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  expect((await (await request.post("/api/watch/token", { data: { deviceCode: paired.deviceCode } })).json())).toEqual({ status: "pending" });

  // L'athlète saisit le code dans son profil sportif.
  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete/profile#montre");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Montre Garmin", exact: true }) });
  await panel.getByLabel("Code affiché par la montre").fill("ZZZZ-ZZZZ");
  await panel.getByRole("button", { name: "Associer la montre" }).click();
  await expect(panel.getByText(/Code inconnu ou expiré/)).toBeVisible();
  await expect(panel.getByLabel("Code affiché par la montre")).toHaveValue("ZZZZ-ZZZZ");
  await panel.getByLabel("Code affiché par la montre").fill(paired.display.toLowerCase());
  await panel.getByRole("button", { name: "Associer la montre" }).click();
  await expect(panel.getByText("Montre associée : Forerunner 965. Elle affiche vos séances dans quelques secondes.")).toBeVisible();
  await expect(panel.getByText("Forerunner 965", { exact: true })).toBeVisible();
  await expect(panel.getByText(/En attente de la montre/)).toBeVisible();

  // La montre reçoit son jeton, une seule fois.
  const claimed = await (await request.post("/api/watch/token", { data: { deviceCode: paired.deviceCode } })).json();
  expect(claimed).toMatchObject({ status: "ready", athlete: accounts().athlete.name });
  expect(claimed.token).toMatch(/^[0-9a-f]{64}$/);
  expect(await (await request.post("/api/watch/token", { data: { deviceCode: paired.deviceCode } })).json()).toEqual({ status: "claimed" });
  const auth = { authorization: `Bearer ${claimed.token}` };
  await page.reload();
  await expect(panel.getByText(/Associée le .*, pas encore de séance chargée/)).toBeVisible();

  // Ses séances des 7 prochains jours, en résumé.
  const summary = await (await request.get("/api/watch/sessions", { headers: auth })).json();
  expect(summary.status).toBe("ok");
  const entry = summary.sessions.find((s: { id: string }) => s.id === soon);
  expect(entry).toMatchObject({ day: "Demain", sport: "run", durationS: 2400, parts: [{ index: 0, sport: "run", ok: true }] });
  expect(summary.sessions.some((s: { id: string }) => s.id === later)).toBe(false);

  // Le fichier de séance, décodé par le SDK FIT officiel.
  const fit = await request.get(`/api/watch/sessions/${soon}/fit?part=0`, { headers: auth });
  expect(fit.status()).toBe(200);
  expect(fit.headers()["content-type"]).toBe("application/vnd.ant.fit");
  const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(await fit.body()))).read();
  expect(errors).toEqual([]);
  expect(messages.fileIdMesgs?.[0]?.type).toBe("workout");
  expect(String(messages.workoutMesgs?.[0]?.wktName)).toContain(`Footing montre ${stamp}`.slice(0, 10));
  expect(messages.workoutStepMesgs).toHaveLength(3);
  expect((await request.get(`/api/watch/sessions/${later}/fit`, { headers: auth })).status()).toBe(404);
  expect((await request.get(`/api/watch/sessions/${soon}/fit`)).status()).toBe(401);
  expect(await (await request.get("/api/watch/sessions")).json()).toEqual({ status: "unauthorized" });

  await page.reload();
  await expect(panel.getByText(/dernières séances chargées le/)).toBeVisible();

  // Dissociée : la montre n'a plus accès à rien.
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Dissocier" }).click();
  await expect(panel.getByText("Forerunner 965", { exact: true })).toHaveCount(0);
  expect(await (await request.get("/api/watch/sessions", { headers: auth })).json()).toEqual({ status: "unauthorized" });
  expect((await request.get(`/api/watch/sessions/${soon}/fit`, { headers: auth })).status()).toBe(401);
});
