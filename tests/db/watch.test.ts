/**
 * Montre Garmin : association par code (montre → athlète → montre), jeton remis une fois,
 * séances des 7 prochains jours seulement, révocation, et rien de lisible directement par l'API.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, insertSession, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let other: TestUser;
let coach: TestUser;
let today: string;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète montre" });
  other = await createUser({ name: "Autre athlète montre" });
  coach = await createUser({ name: "Coach montre", coach: true });
  await linkCoach(coach, athlete);
  await linkCoach(coach, other);
  const { rows } = await asSuperuser("select ((now() at time zone 'Europe/Paris')::date)::text as d");
  today = rows[0].d;
});

afterAll(closeDb);

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const start = async (name: string | null = "Forerunner 965") =>
  (await as(null, "select * from public.start_watch_pairing($1)", [name])).rows[0] as { device_code: string; user_code: string; expires_at: Date };
const claim = async (deviceCode: string) =>
  (await as(null, "select * from public.claim_watch_token($1)", [deviceCode])).rows[0] as { status: string; token: string | null; athlete_name: string | null };
const confirm = (user: TestUser, code: string) => as(user, "select public.confirm_watch_pairing($1) as name", [code]);
const sessions = async (token: string) => (await as(null, "select public.watch_sessions($1) as data", [token])).rows[0].data;

/** Association complète d'une montre à un athlète ; renvoie le jeton de la montre. */
async function pair(user: TestUser = athlete) {
  const pairing = await start();
  await confirm(user, pairing.user_code);
  const claimed = await claim(pairing.device_code);
  expect(claimed.status).toBe("ready");
  return claimed.token!;
}

describe("association d'une montre Garmin", () => {
  it("la montre affiche un code, l'athlète le saisit, la montre reçoit son jeton une seule fois", async () => {
    const pairing = await start("  Forerunner 965  ");
    expect(pairing.device_code).toMatch(/^[0-9a-f]{64}$/);
    expect(pairing.user_code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(pairing.expires_at.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(await claim(pairing.device_code)).toEqual({ status: "pending", token: null, athlete_name: null });

    // Saisie tolérante : minuscules, tiret, espaces.
    const typed = `${pairing.user_code.slice(0, 4).toLowerCase()}-${pairing.user_code.slice(4)} `;
    const confirmed = await confirm(athlete, typed);
    expect(confirmed.rows[0].name).toBe("Forerunner 965");
    // La montre figure aussitôt dans le profil, « en attente » de son jeton.
    const pending = await as(athlete, "select id, connected_at from public.watch_devices where revoked_at is null order by created_at desc limit 1");
    expect(pending.rows[0].connected_at).toBeNull();

    const claimed = await claim(pairing.device_code);
    expect(claimed.status).toBe("ready");
    expect(claimed.token).toMatch(/^[0-9a-f]{64}$/);
    expect(claimed.athlete_name).toBe("Athlète montre");
    expect(await claim(pairing.device_code)).toEqual({ status: "claimed", token: null, athlete_name: null });
    const connected = await as(athlete, "select connected_at from public.watch_devices where id = $1", [pending.rows[0].id]);
    expect(connected.rows[0].connected_at).toBeInstanceOf(Date);

    // Le code ne sert qu'une fois, et rien n'est gardé en clair.
    await expectFailure(confirm(other, pairing.user_code), /pairing_not_found/);
    const stored = await asSuperuser("select count(*)::int as n from public.watch_devices where token_hash = $1", [claimed.token]);
    expect(stored.rows[0].n).toBe(0);
    expect(await claim("inconnu")).toEqual({ status: "unknown", token: null, athlete_name: null });
  });

  it("un code expiré ou inventé ne mène à rien ; il faut être connecté pour confirmer", async () => {
    const pairing = await start(null);
    await asSuperuser("update public.watch_pairings set expires_at = now() - interval '1 second' where user_code = $1", [pairing.user_code]);
    await expectFailure(confirm(athlete, pairing.user_code), /pairing_not_found/);
    expect((await claim(pairing.device_code)).status).toBe("expired");
    await expectFailure(confirm(athlete, "ABCDEFGH"), /pairing_not_found/);
    await expectFailure(as(null, "select public.confirm_watch_pairing('ABCDEFGH')"), /permission denied/);
  });

  it("une montre dissociée avant d'avoir récupéré son jeton n'en reçoit pas", async () => {
    const pairing = await start("Fenix 7");
    await confirm(athlete, pairing.user_code);
    const pending = await as(athlete, "select id from public.watch_devices where device_name = 'Fenix 7' and revoked_at is null");
    await as(athlete, "select public.revoke_watch_device($1)", [pending.rows[0].id]);
    expect(await claim(pairing.device_code)).toEqual({ status: "expired", token: null, athlete_name: null });
  });

  it("ni les associations ni les jetons ne se lisent par l'API ; l'athlète voit ses montres", async () => {
    await pair();
    await expectFailure(as(athlete, "select * from public.watch_pairings"), DENIED);
    await expectFailure(as(null, "select * from public.watch_pairings"), DENIED);
    await expectFailure(as(athlete, "select token_hash from public.watch_devices"), DENIED);
    await expectFailure(as(athlete, "insert into public.watch_devices (athlete_id, device_name, token_hash) values ($1, 'x', 'y')", [athlete.id]), DENIED);
    const own = await as(athlete, "select device_name, last_seen_at from public.watch_devices where revoked_at is null");
    expect(own.rowCount).toBeGreaterThan(0);
    expect(own.rows[0].device_name).toBe("Forerunner 965");
    const others = await as(other, "select id from public.watch_devices");
    expect(others.rowCount).toBe(0);
    const fromCoach = await as(coach, "select id from public.watch_devices");
    expect(fromCoach.rowCount).toBe(0);
  });
});

describe("séances servies à la montre", () => {
  it("les séances publiées d'aujourd'hui à J+6, de cet athlète seulement, avec ses seuils", async () => {
    const token = await pair();
    const ids = {
      yesterday: (await insertSession(coach, athlete, { date: shift(today, -1), title: "Hier" })).id,
      today: (await insertSession(coach, athlete, { date: today, title: "Aujourd'hui" })).id,
      last: (await insertSession(coach, athlete, { date: shift(today, 6), title: "J+6" })).id,
      tooFar: (await insertSession(coach, athlete, { date: shift(today, 7), title: "J+7" })).id,
      draft: (await insertSession(coach, athlete, { date: today, title: "Brouillon", state: "draft" })).id,
      cancelled: (await insertSession(coach, athlete, { date: today, title: "Annulée", state: "cancelled" })).id,
      foreign: (await insertSession(coach, other, { date: today, title: "Autre athlète" })).id,
    };
    await as(athlete, "insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from) values ($1, 'bike', 'ftp_w', 268, '2026-01-01')", [athlete.id]);

    const data = await sessions(token);
    expect(data.status).toBe("ok");
    expect(data.today).toBe(today);
    expect(data.athlete).toMatchObject({ id: athlete.id, name: "Athlète montre" });
    const seen = data.sessions.map((s: { id: string }) => s.id);
    expect(seen).toContain(ids.today);
    expect(seen).toContain(ids.last);
    for (const hidden of [ids.yesterday, ids.tooFar, ids.draft, ids.cancelled, ids.foreign]) expect(seen).not.toContain(hidden);
    const first = data.sessions.find((s: { id: string }) => s.id === ids.today);
    expect(first).toMatchObject({ sport: "bike", title: "Aujourd'hui", scheduled_date: today });
    expect(first.content.segments).toHaveLength(1);
    expect(data.thresholds).toContainEqual({ sport: "bike", metric: "ftp_w", value: 268, effective_from: "2026-01-01" });

    const seenAt = await asSuperuser("select last_seen_at from public.watch_devices where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [token]);
    expect(seenAt.rows[0].last_seen_at).toBeInstanceOf(Date);
  });

  it("révocation : seul l'athlète dissocie sa montre, et le jeton ne vaut plus rien aussitôt", async () => {
    const token = await pair();
    const { rows } = await asSuperuser("select id from public.watch_devices where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [token]);
    const device = rows[0].id as string;
    await expectFailure(as(other, "select public.revoke_watch_device($1)", [device]), /watch_not_found/);
    await expectFailure(as(coach, "select public.revoke_watch_device($1)", [device]), /watch_not_found/);
    await expectFailure(as(null, "select public.revoke_watch_device($1)", [device]), /permission denied/);
    expect((await sessions(token)).status).toBe("ok");
    await as(athlete, "select public.revoke_watch_device($1)", [device]);
    expect(await sessions(token)).toEqual({ status: "unauthorized" });
    expect(await sessions("faux-jeton")).toEqual({ status: "unauthorized" });
    await expectFailure(as(athlete, "select public.revoke_watch_device($1)", [device]), /watch_not_found/);
  });

  it("cinq montres actives au plus par athlète", async () => {
    const user = await createUser({ name: "Athlète cinq montres" });
    for (let i = 0; i < 5; i += 1) await pair(user);
    const sixth = await start();
    await expectFailure(confirm(user, sixth.user_code), /too_many_watches/);
  });
});
