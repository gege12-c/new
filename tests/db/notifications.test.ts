import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, insertSession, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let outsider: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète notifications" });
  coach = await createUser({ name: "Coach notifications", coach: true });
  outsider = await createUser({ name: "Coach extérieur notifications", coach: true });
  await linkCoach(coach, athlete);
});

afterAll(closeDb);

async function inbox(user: TestUser) {
  const { rows } = await as(user, "select kind, session_id, actor_id, payload, read_at from public.notifications order by created_at desc");
  return rows as { kind: string; session_id: string | null; actor_id: string | null; payload: Record<string, unknown>; read_at: string | null }[];
}

async function clear(user: TestUser) {
  await asSuperuser("delete from public.notifications where recipient_id = $1", [user.id]);
}

describe("notifications", () => {
  it("une séance publiée par le coach prévient l'athlète, pas le coach ; un brouillon ne prévient personne", async () => {
    await clear(athlete);
    await clear(coach);
    await insertSession(coach, athlete, { state: "draft", title: "Brouillon" });
    expect(await inbox(athlete)).toEqual([]);
    const published = await insertSession(coach, athlete, { title: "Seuil du mardi", date: "2026-11-03" });
    const [notification] = await inbox(athlete);
    expect(notification).toMatchObject({ kind: "session_published", session_id: published.id, actor_id: coach.id, payload: { title: "Seuil du mardi", date: "2026-11-03" } });
    expect(await inbox(coach)).toEqual([]);
  });

  it("plusieurs séances publiées d'un coup donnent une seule notification groupée", async () => {
    await clear(athlete);
    await insertSession(coach, athlete, { title: "A", date: "2026-11-09" });
    await insertSession(coach, athlete, { title: "B", date: "2026-11-11" });
    await insertSession(coach, athlete, { title: "C", date: "2026-11-10" });
    const list = await inbox(athlete);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "session_published", session_id: null, payload: { count: 3, date: "2026-11-09", last_date: "2026-11-11" } });
  });

  it("modification, déplacement et annulation d'une séance publiée ; l'auteur n'est jamais prévenu", async () => {
    const session = await insertSession(coach, athlete, { title: "Footing", date: "2026-11-12" });
    await clear(athlete);
    await clear(coach);
    await as(coach, "update public.planned_sessions set title = 'Footing long' where id = $1", [session.id]);
    await as(coach, "update public.planned_sessions set description = 'Plus long' where id = $1", [session.id]);
    let list = await inbox(athlete);
    // Deux modifications rapprochées : une seule notification, à jour.
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "session_updated", payload: { title: "Footing long" } });

    // L'athlète déplace la séance : son coach est prévenu, avec l'ancienne date.
    await as(athlete, "update public.planned_sessions set scheduled_date = '2026-11-13' where id = $1", [session.id]);
    const forCoach = await inbox(coach);
    expect(forCoach[0]).toMatchObject({ kind: "session_updated", actor_id: athlete.id, payload: { date: "2026-11-13", previous_date: "2026-11-12" } });

    await as(coach, "update public.planned_sessions set state = 'cancelled' where id = $1", [session.id]);
    list = await inbox(athlete);
    expect(list[0]).toMatchObject({ kind: "session_cancelled", session_id: session.id });
  });

  it("commentaire partagé : l'autre partie est prévenue ; note privée : personne", async () => {
    const session = await insertSession(coach, athlete, { title: "Natation", date: "2026-11-14" });
    await clear(athlete);
    await clear(coach);
    await as(coach, "insert into public.session_comments (session_id, body) values ($1, 'Bien récupérer')", [session.id]);
    await as(coach, "insert into public.session_comments (session_id, body, visibility) values ($1, 'Note pour moi', 'coach_private')", [session.id]);
    expect((await inbox(athlete)).map((n) => [n.kind, n.payload.excerpt])).toEqual([["comment", "Bien récupérer"]]);
    await as(athlete, "insert into public.session_comments (session_id, body) values ($1, 'Merci')", [session.id]);
    expect((await inbox(coach)).map((n) => n.kind)).toEqual(["comment"]);
  });

  it("chacun ne lit et ne marque que ses propres notifications", async () => {
    await insertSession(coach, athlete, { title: "Visible", date: "2026-11-16" });
    const seenByOutsider = await as(outsider, "select count(*)::int as n from public.notifications");
    expect(seenByOutsider.rows[0].n).toBe(0);
    await expectFailure(as(athlete, "insert into public.notifications (recipient_id, kind) values ($1, 'comment')", [athlete.id]), DENIED);
    await expectFailure(as(athlete, "update public.notifications set kind = 'reconnect'"), DENIED);
    const { rows } = await as(athlete, "select public.mark_notifications_read() as n");
    expect(rows[0].n).toBeGreaterThan(0);
    expect((await inbox(athlete)).every((n) => n.read_at !== null)).toBe(true);
    const outsiderMarked = await as(outsider, "select public.mark_notifications_read() as n");
    expect(outsiderMarked.rows[0].n).toBe(0);
  });

  it("un type coupé dans les réglages ne crée plus rien", async () => {
    await clear(athlete);
    // Upsert tel que PostgREST l'écrit : user_id figure aussi dans la mise à jour.
    await as(
      athlete,
      "insert into public.notification_preferences (user_id, disabled_kinds) values ($1, '{session_published}') on conflict (user_id) do update set user_id = excluded.user_id, disabled_kinds = excluded.disabled_kinds",
      [athlete.id],
    );
    await insertSession(coach, athlete, { title: "Muette", date: "2026-11-17" });
    expect(await inbox(athlete)).toEqual([]);
    await expectFailure(as(athlete, "insert into public.notification_preferences (user_id, disabled_kinds) values ($1, '{}')", [coach.id]), DENIED);
    await expectFailure(as(athlete, "update public.notification_preferences set disabled_kinds = '{inconnu}'"), /check constraint/);
    await as(athlete, "update public.notification_preferences set disabled_kinds = '{}' where user_id = $1", [athlete.id]);
  });

  it("reconnexion Strava nécessaire et export échoué", async () => {
    await clear(athlete);
    await clear(coach);
    const { rows } = await asSuperuser(
      "insert into public.external_connections (athlete_id, provider, external_athlete_id) values ($1, 'strava', $2) on conflict (athlete_id, provider) do update set status = 'active' returning id",
      [athlete.id, String(Math.floor(Math.random() * 1e9))],
    );
    await asSuperuser("update public.external_connections set status = 'reauth_required' where id = $1", [rows[0].id]);
    expect((await inbox(athlete)).map((n) => [n.kind, n.payload.provider])).toEqual([["reconnect", "strava"]]);

    const session = await insertSession(coach, athlete, { title: "PMA", date: "2026-11-18" });
    await as(
      athlete,
      `insert into public.workout_exports (session_id, provider, format, session_version, status, error)
       values ($1, 'zwift', 'zwo', 1, 'failed', 'Zwift exige une intensité en course.')`,
      [session.id],
    );
    const [forCoach] = await inbox(coach);
    expect(forCoach).toMatchObject({ kind: "export_failed", actor_id: athlete.id, payload: { provider: "zwift", title: "PMA" } });
  });

  it("séance passée sans retour ni activité : une notification, une seule fois", async () => {
    const day = "2026-11-20";
    const done = await insertSession(coach, athlete, { title: "Faite", date: day });
    const forgotten = await insertSession(coach, athlete, { title: "Oubliée", date: day });
    await as(athlete, "insert into public.session_completions (session_id, status) values ($1, 'done')", [done.id]);
    await clear(athlete);
    await expectFailure(as(athlete, "select public.notify_missing_feedback($1)", [day]), DENIED);
    const first = await asSuperuser("select public.notify_missing_feedback($1) as n", [day]);
    const again = await asSuperuser("select public.notify_missing_feedback($1) as n", [day]);
    expect([first.rows[0].n, again.rows[0].n]).toEqual([1, 0]);
    expect((await inbox(athlete)).map((n) => [n.kind, n.session_id])).toEqual([["missing_feedback", forgotten.id]]);
  });
});
