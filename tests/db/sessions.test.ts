import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  closeDb,
  createUser,
  DENIED,
  expectFailure,
  insertSession,
  linkCoach,
  workoutJson,
  type TestUser,
} from "./helpers";

let athlete: TestUser;
let coach: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète" });
  coach = await createUser({ name: "Coach", coach: true });
  await linkCoach(coach, athlete);
});

afterAll(closeDb);

describe("séances planifiées", () => {
  it("l'athlète ne voit pas les brouillons du coach, puis voit la séance publiée", async () => {
    const draft = await insertSession(coach, athlete, { state: "draft" });
    expect((await as(athlete, "select 1 from public.planned_sessions where id = $1", [draft.id])).rowCount).toBe(0);

    await as(coach, "update public.planned_sessions set state = 'published' where id = $1", [draft.id]);
    const seen = await as(athlete, "select state, published_at, version from public.planned_sessions where id = $1", [draft.id]);
    expect(seen.rows[0].state).toBe("published");
    expect(seen.rows[0].published_at).not.toBeNull();
    expect(seen.rows[0].version).toBe(2);
  });

  it("l'athlète déplace une séance de son coach, sans pouvoir en changer le contenu", async () => {
    const session = await insertSession(coach, athlete);
    const moved = await as(athlete, "update public.planned_sessions set scheduled_date = '2026-11-05', start_time = '07:30' where id = $1", [
      session.id,
    ]);
    expect(moved.rowCount).toBe(1);
    await expectFailure(
      as(athlete, "update public.planned_sessions set title = 'Plus court' where id = $1", [session.id]),
      /athlete_can_only_reschedule/,
    );
    await expectFailure(
      as(athlete, "update public.planned_sessions set state = 'cancelled' where id = $1", [session.id]),
      /athlete_can_only_reschedule/,
    );
    const row = await as(coach, "select scheduled_date::text, start_time::text, title, updated_by from public.planned_sessions where id = $1", [
      session.id,
    ]);
    expect(row.rows[0]).toEqual({ scheduled_date: "2026-11-05", start_time: "07:30:00", title: "Seuil 4 × 8 min", updated_by: athlete.id });
  });

  it("l'athlète gère librement ses propres séances", async () => {
    const own = await insertSession(athlete, athlete, { state: "draft", title: "Footing" });
    expect((await as(athlete, "update public.planned_sessions set title = 'Footing long' where id = $1", [own.id])).rowCount).toBe(1);
    expect((await as(athlete, "delete from public.planned_sessions where id = $1", [own.id])).rowCount).toBe(1);
  });

  it("l'athlète ne supprime pas une séance de son coach", async () => {
    const session = await insertSession(coach, athlete);
    expect((await as(athlete, "delete from public.planned_sessions where id = $1", [session.id])).rowCount).toBe(0);
    expect((await as(coach, "select 1 from public.planned_sessions where id = $1", [session.id])).rowCount).toBe(1);
  });

  it("personne ne change l'athlète, l'auteur ou la version d'une séance", async () => {
    const session = await insertSession(coach, athlete);
    const other = await createUser({ name: "Autre" });
    await expectFailure(
      as(coach, "update public.planned_sessions set athlete_id = $1 where id = $2", [other.id, session.id]),
      DENIED,
    );
    await expectFailure(as(coach, "update public.planned_sessions set created_by = $1 where id = $2", [other.id, session.id]), DENIED);
    await expectFailure(as(coach, "update public.planned_sessions set version = 99 where id = $1", [session.id]), DENIED);
  });

  it("la version permet de détecter une modification concurrente", async () => {
    const session = await insertSession(coach, athlete);
    // Deux onglets lisent la version 1, le premier enregistre…
    const first = await as(coach, "update public.planned_sessions set title = 'A' where id = $1 and version = $2", [session.id, 1]);
    expect(first.rowCount).toBe(1);
    // …le second, resté sur la version 1, ne peut pas écraser silencieusement.
    const second = await as(coach, "update public.planned_sessions set title = 'B' where id = $1 and version = $2", [session.id, 1]);
    expect(second.rowCount).toBe(0);
  });

  it("refuse un contenu qui n'est pas une séance au format v1", async () => {
    await expectFailure(
      as(
        coach,
        `insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content)
         values ($1, '2026-11-02', 'bike', 'Mauvais format', '{"schemaVersion": 2, "segments": []}'::jsonb)`,
        [athlete.id],
      ),
      /planned_sessions_content_check|violates check constraint/,
    );
  });

  it("journalise qui a modifié quoi, sans recopier le contenu structuré", async () => {
    const session = await insertSession(coach, athlete);
    const content = JSON.parse(workoutJson());
    content.segments[0].title = "Variante";
    await as(coach, "update public.planned_sessions set title = 'Seuil long', content = $1::jsonb where id = $2", [
      JSON.stringify(content),
      session.id,
    ]);
    const log = await as(athlete, "select actor_id, action, changes from public.audit_logs where entity_id = $1 order by id", [session.id]);
    expect(log.rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(log.rows[1]).toEqual({
      actor_id: coach.id,
      action: "update",
      changes: { title: ["Seuil 4 × 8 min", "Seuil long"], content: "modifié" },
    });
    expect(log.rows[0].changes).not.toHaveProperty("content");
  });
});

describe("seuils et compétitions", () => {
  it("renvoie les seuils en vigueur à une date donnée", async () => {
    for (const [value, date] of [
      [250, "2026-01-10"],
      [265, "2026-06-01"],
      [280, "2026-12-01"],
    ] as const) {
      await as(
        coach,
        "insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from) values ($1, 'bike', 'ftp_w', $2, $3)",
        [athlete.id, value, date],
      );
    }
    const atSummer = await as(athlete, "select metric, value::int from public.athlete_thresholds_at($1, '2026-08-15')", [athlete.id]);
    expect(atSummer.rows).toContainEqual({ metric: "ftp_w", value: 265 });
  });

  it("refuse une métrique incohérente avec la discipline ou une valeur aberrante", async () => {
    await expectFailure(
      as(
        athlete,
        "insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from) values ($1, 'swim', 'ftp_w', 250, '2026-10-01')",
        [athlete.id],
      ),
      /athlete_thresholds_metric/,
    );
    await expectFailure(
      as(
        athlete,
        "insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from) values ($1, 'bike', 'ftp_w', 2000, '2026-10-01')",
        [athlete.id],
      ),
      /athlete_thresholds_value/,
    );
  });

  it("le coach ajoute une compétition, visible par l'athlète", async () => {
    await as(coach, "insert into public.athlete_events (athlete_id, name, event_date, priority) values ($1, 'Embrunman', '2027-08-15', 'A')", [
      athlete.id,
    ]);
    const events = await as(athlete, "select name, priority from public.athlete_events where athlete_id = $1", [athlete.id]);
    expect(events.rows).toContainEqual({ name: "Embrunman", priority: "A" });
  });
});

describe("profils", () => {
  it("crée le profil à l'inscription avec les métadonnées fournies", async () => {
    const user = await createUser({ name: "Nouvelle coach", coach: true });
    const profile = await as(user, "select display_name, is_coach, timezone from public.profiles where id = $1", [user.id]);
    expect(profile.rows).toEqual([{ display_name: "Nouvelle coach", is_coach: true, timezone: "Europe/Paris" }]);
  });

  it("refuse un fuseau horaire inconnu", async () => {
    const user = await createUser({ name: "Voyageur" });
    await expectFailure(as(user, "update public.profiles set timezone = 'Mars/Olympus' where id = $1", [user.id]), /invalid_timezone/);
    const ok = await as(user, "update public.profiles set timezone = 'America/Cancun' where id = $1", [user.id]);
    expect(ok.rowCount).toBe(1);
  });
});
