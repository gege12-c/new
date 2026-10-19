import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, insertSession, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let outsider: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète exports" });
  coach = await createUser({ name: "Coach exports", coach: true });
  outsider = await createUser({ name: "Coach extérieur exports", coach: true });
  await linkCoach(coach, athlete);
});

afterAll(closeDb);

const SHA = "a".repeat(64);

function recordExport(user: TestUser, sessionId: string, overrides: Record<string, unknown> = {}) {
  const row = {
    provider: "garmin",
    format: "fit",
    segment_index: 0,
    session_version: 1,
    status: "succeeded",
    file_name: "Seuil.fit",
    byte_size: 321,
    sha256: SHA,
    issues: [],
    error: null,
    ...overrides,
  };
  return as(
    user,
    `insert into public.workout_exports (session_id, provider, format, segment_index, session_version, status, file_name, byte_size, sha256, issues, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
     returning id, athlete_id, requested_by`,
    [sessionId, row.provider, row.format, row.segment_index, row.session_version, row.status, row.file_name, row.byte_size, row.sha256, JSON.stringify(row.issues), row.error],
  );
}

describe("historique des exports", () => {
  it("l'athlète enregistre l'export d'une séance publiée ; l'athlète et le coach le voient", async () => {
    const session = await insertSession(coach, athlete);
    const { rows } = await recordExport(athlete, session.id, { issues: [{ severity: "loss", message: "Cadence ramenée à 90" }] });
    expect(rows[0]).toMatchObject({ athlete_id: athlete.id, requested_by: athlete.id });

    const forCoach = await as(coach, "select provider, status, issues from public.workout_exports where session_id = $1", [session.id]);
    expect(forCoach.rows).toEqual([{ provider: "garmin", status: "succeeded", issues: [{ severity: "loss", message: "Cadence ramenée à 90" }] }]);
    const forAthlete = await as(athlete, "select count(*)::int as n from public.workout_exports where session_id = $1", [session.id]);
    expect(forAthlete.rows[0].n).toBe(1);
  });

  it("le coach exporte aussi ; l'auteur et l'athlète sont fixés par la base", async () => {
    const session = await insertSession(coach, athlete);
    const { rows } = await as(
      coach,
      `insert into public.workout_exports (session_id, provider, format, session_version, status, error)
       values ($1, 'zwift', 'zwo', 1, 'failed', 'Zwift ne propose que le vélo et la course à pied.')
       returning athlete_id, requested_by`,
      [session.id],
    );
    expect(rows[0]).toEqual({ athlete_id: athlete.id, requested_by: coach.id });
    // Impossible de se faire passer pour quelqu'un d'autre : colonne non accessible.
    await expectFailure(
      as(coach, "insert into public.workout_exports (session_id, provider, format, session_version, status, error, requested_by) values ($1, 'zwift', 'zwo', 1, 'failed', 'x', $2)", [
        session.id,
        athlete.id,
      ]),
      DENIED,
    );
  });

  it("un coach non autorisé ne lit ni n'ajoute rien", async () => {
    const session = await insertSession(coach, athlete);
    await recordExport(athlete, session.id);
    const seen = await as(outsider, "select count(*)::int as n from public.workout_exports where session_id = $1", [session.id]);
    expect(seen.rows[0].n).toBe(0);
    await expectFailure(recordExport(outsider, session.id), DENIED);
  });

  it("l'athlète ne peut pas exporter un brouillon qu'il ne voit pas", async () => {
    const draft = await insertSession(coach, athlete, { state: "draft" });
    await expectFailure(recordExport(athlete, draft.id), DENIED);
    const { rows } = await recordExport(coach, draft.id);
    expect(rows[0].requested_by).toBe(coach.id);
  });

  it("l'historique ne se modifie ni ne s'efface", async () => {
    const session = await insertSession(coach, athlete);
    const { rows } = await recordExport(athlete, session.id);
    await expectFailure(as(athlete, "update public.workout_exports set status = 'failed' where id = $1", [rows[0].id]), DENIED);
    const deleted = await as(athlete, "delete from public.workout_exports where id = $1", [rows[0].id]).catch((e: Error) => e);
    if (deleted instanceof Error) expect(deleted.message).toMatch(DENIED);
    else expect(deleted.rowCount).toBe(0);
    const still = await asSuperuser("select count(*)::int as n from public.workout_exports where id = $1", [rows[0].id]);
    expect(still.rows[0].n).toBe(1);
  });

  it("refuse les incohérences : format, version future, succès sans fichier", async () => {
    const session = await insertSession(coach, athlete);
    await expectFailure(recordExport(athlete, session.id, { provider: "zwift", format: "fit" }), /workout_exports_provider_format/);
    await expectFailure(recordExport(athlete, session.id, { session_version: 99 }), /invalid_session_version/);
    await expectFailure(recordExport(athlete, session.id, { sha256: null }), /workout_exports_outcome/);
    await expectFailure(recordExport(athlete, session.id, { status: "failed", error: null, file_name: null, sha256: null, byte_size: null }), /workout_exports_outcome/);
  });

  it("disparaît avec la séance", async () => {
    const session = await insertSession(coach, athlete);
    await recordExport(athlete, session.id);
    await as(coach, "delete from public.planned_sessions where id = $1", [session.id]);
    const left = await asSuperuser("select count(*)::int as n from public.workout_exports where session_id = $1", [session.id]);
    expect(left.rows[0].n).toBe(0);
  });
});
