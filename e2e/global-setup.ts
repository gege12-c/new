/**
 * Prépare un coach et un athlète neufs, reliés par une invitation acceptée, via l'API Supabase
 * (comme le ferait l'application). Les identifiants sont écrits dans e2e/.accounts.json.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

export const ACCOUNTS_FILE = path.join(__dirname, ".accounts.json");
export const PASSWORD = "E2e-tricoach-2026";

async function call(url: string, init: RequestInit & { token?: string }) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquante pour les tests de bout en bout.");
  const response = await fetch(url, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${init.token ?? key}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

export default async function globalSetup() {
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!api) throw new Error("NEXT_PUBLIC_SUPABASE_URL manquante pour les tests de bout en bout.");
  const run = randomUUID().slice(0, 8);
  const signUp = async (name: string, coach: boolean) => {
    const email = `${name.toLowerCase()}-${run}@e2e.local`;
    const body = await call(`${api}/auth/v1/signup`, {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD, data: { display_name: `${name} E2E`, is_coach: coach, timezone: "Europe/Paris" } }),
    });
    if (!body.access_token) throw new Error("Inscription sans session : désactivez la confirmation d'email de la pile locale.");
    return { id: body.user.id as string, email, token: body.access_token as string, name: `${name} E2E` };
  };
  const coach = await signUp("Coach", true);
  const athlete = await signUp("Athlete", false);
  const [invitation] = await call(`${api}/rest/v1/rpc/create_invitation`, {
    method: "POST",
    token: coach.token,
    body: JSON.stringify({ p_email: athlete.email, p_valid_hours: 24 }),
  });
  await call(`${api}/rest/v1/rpc/accept_invitation`, { method: "POST", token: athlete.token, body: JSON.stringify({ p_token: invitation.token }) });
  await call(`${api}/rest/v1/athlete_thresholds`, {
    method: "POST",
    token: athlete.token,
    body: JSON.stringify([{ athlete_id: athlete.id, sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-01" }]),
  });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify({ coach, athlete, password: PASSWORD }, null, 2));
}
