/**
 * Montres (intervals.icu, Suunto) : mise en file d'un envoi à chaque changement visible sur la
 * montre (et seulement pour un compte relié actif), réservation des jobs par type, bail d'envoi par
 * compte, état des envois lisible par l'athlète et ses coachs seulement, jamais écrit par l'API.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, insertSession, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let other: TestUser;
let coach: TestUser;
let stranger: TestUser;
let connection: string;

const pendingJobs = async (user: TestUser = athlete) =>
  Number(
    (await asSuperuser("select count(*)::int as n from public.sync_jobs where kind = 'suunto_sync' and athlete_id = $1 and status = 'pending'", [user.id])).rows[0]
      .n,
  );
const clearJobs = () => asSuperuser("delete from public.sync_jobs where kind in ('suunto_sync', 'intervals_sync')");

async function connect(user: TestUser, username: string, provider: "suunto" | "intervals" = "suunto") {
  const { rows } = await asSuperuser(
    "insert into public.external_connections (athlete_id, provider, external_athlete_id) values ($1, $2, $3) returning id",
    [user.id, provider, username],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète Suunto" });
  other = await createUser({ name: "Autre athlète Suunto" });
  coach = await createUser({ name: "Coach Suunto", coach: true });
  stranger = await createUser({ name: "Coach étranger Suunto", coach: true });
  await linkCoach(coach, athlete);
  await linkCoach(coach, other);
  connection = await connect(athlete, `suunto-${athlete.id.slice(0, 8)}`);
});

afterAll(closeDb);

describe("mise en file des envois vers la montre", () => {
  it("sans compte Suunto relié, publier ne met rien en file", async () => {
    await clearJobs();
    const session = await insertSession(coach, other, { state: "published" });
    await as(coach, "update public.planned_sessions set title = 'Modifiée' where id = $1", [session.id]);
    expect(await pendingJobs(other)).toBe(0);
  });

  it("publication, modification, déplacement, annulation et suppression d'une séance publiée : un job chacune", async () => {
    await clearJobs();
    const draft = await insertSession(coach, athlete, { state: "draft" });
    expect(await pendingJobs()).toBe(0);
    // Un brouillon modifié n'est pas sur la montre.
    await as(coach, "update public.planned_sessions set title = 'Brouillon modifié' where id = $1", [draft.id]);
    expect(await pendingJobs()).toBe(0);

    await as(coach, "update public.planned_sessions set state = 'published' where id = $1", [draft.id]);
    expect(await pendingJobs()).toBe(1);
    await as(coach, "update public.planned_sessions set title = 'Seuil, version 2' where id = $1", [draft.id]);
    expect(await pendingJobs()).toBe(2);
    await as(coach, "update public.planned_sessions set scheduled_date = scheduled_date + 1 where id = $1", [draft.id]);
    expect(await pendingJobs()).toBe(3);
    await as(coach, "update public.planned_sessions set state = 'cancelled' where id = $1", [draft.id]);
    expect(await pendingJobs()).toBe(4);
    // Annulée puis modifiée : plus rien à envoyer.
    await as(coach, "update public.planned_sessions set title = 'Annulée' where id = $1", [draft.id]);
    expect(await pendingJobs()).toBe(4);

    const published = await insertSession(coach, athlete, { state: "published" });
    expect(await pendingJobs()).toBe(5);
    await as(coach, "delete from public.planned_sessions where id = $1", [published.id]);
    expect(await pendingJobs()).toBe(6);
  });

  it("un changement de seuils renvoie les guides (cibles en valeurs absolues)", async () => {
    await clearJobs();
    await as(athlete, "insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from) values ($1, 'bike', 'ftp_w', 260, '2026-10-01')", [
      athlete.id,
    ]);
    expect(await pendingJobs()).toBe(1);
  });

  it("intervals.icu et Suunto reliés : un envoi en file pour chacun", async () => {
    const both = await createUser({ name: "Athlète deux montres" });
    await connect(both, `suunto-${both.id.slice(0, 8)}`);
    await connect(both, `i${both.id.slice(0, 6)}`, "intervals");
    await clearJobs();
    await insertSession(both, both, { state: "published" });
    const { rows } = await asSuperuser("select kind from public.sync_jobs where athlete_id = $1 and status = 'pending' order by kind", [both.id]);
    expect(rows.map((r) => r.kind)).toEqual(["intervals_sync", "suunto_sync"]);
  });

  it("compte Suunto à reconnecter : rien en file", async () => {
    await clearJobs();
    await asSuperuser("update public.external_connections set status = 'reauth_required' where id = $1", [connection]);
    await insertSession(coach, athlete, { state: "published" });
    expect(await pendingJobs()).toBe(0);
    await asSuperuser("update public.external_connections set status = 'active' where id = $1", [connection]);
  });

  it("la suppression d'un compte relié à Suunto, avec des séances publiées, aboutit", async () => {
    const leaving = await createUser({ name: "Athlète Suunto qui part" });
    await connect(leaving, `suunto-${leaving.id.slice(0, 8)}`);
    await insertSession(leaving, leaving, { state: "published" });
    await as(leaving, "select public.delete_my_account()");
    const { rows } = await asSuperuser("select count(*)::int as n from public.profiles where id = $1", [leaving.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe("réservation des jobs et bail d'envoi", () => {
  it("chaque exécutant ne réserve que ses types de jobs", async () => {
    await clearJobs();
    await asSuperuser("delete from public.sync_jobs where kind = 'maintenance' and status = 'pending'");
    await asSuperuser("insert into public.sync_jobs (kind, dedupe_key) values ('maintenance', $1)", [`maintenance:test:${Date.now()}`]);
    await insertSession(coach, athlete, { state: "published" });
    const suunto = await asSuperuser("select kind from public.claim_sync_jobs(10, array['suunto_sync'])");
    expect(suunto.rows.map((r) => r.kind)).toEqual(["suunto_sync"]);
    expect((await asSuperuser("select kind from public.claim_sync_jobs(10, array['intervals_sync'])")).rows).toEqual([]);
    const strava = (await asSuperuser("select kind from public.claim_sync_jobs(50, array['strava_event', 'strava_sync', 'maintenance'])")).rows.map((r) => r.kind);
    expect(strava).toContain("maintenance");
    expect(strava).not.toContain("suunto_sync");
  });

  it("réservation et bail : réservés au serveur", async () => {
    await expectFailure(as(athlete, "select * from public.claim_sync_jobs(1, array['suunto_sync'])"), DENIED);
    await expectFailure(as(athlete, "select public.acquire_sync_lease($1, 60)", [connection]), DENIED);
    await expectFailure(as(null, "select public.release_sync_lease($1)", [connection]), DENIED);
  });

  it("un seul exécutant à la fois par compte ; un bail expiré se reprend", async () => {
    const take = async () => (await asSuperuser("select public.acquire_sync_lease($1, 60) as ok", [connection])).rows[0].ok as boolean;
    expect(await take()).toBe(true);
    expect(await take()).toBe(false);
    await asSuperuser("select public.release_sync_lease($1)", [connection]);
    expect(await take()).toBe(true);
    await asSuperuser("update public.external_connections set sync_lease_until = now() - interval '1 second' where id = $1", [connection]);
    expect(await take()).toBe(true);
    await asSuperuser("select public.release_sync_lease($1)", [connection]);
  });
});

describe("séances envoyées", () => {
  let sessionId: string;

  beforeAll(async () => {
    sessionId = (await insertSession(coach, athlete, { state: "published" })).id;
    await asSuperuser(
      `insert into public.device_workouts (connection_id, provider, athlete_id, session_id, segment_index, external_id, remote_id, session_version, scheduled_date, status, sent_at)
       values ($1, 'suunto', $2, $3, 0, $4, 'guide-1', 1, '2026-11-02', 'sent', now())`,
      [connection, athlete.id, sessionId, `tricoach-${sessionId}-0`],
    );
  });

  it("l'athlète et son coach voient l'état d'envoi ; personne d'autre", async () => {
    const read = async (user: TestUser) => (await as(user, "select status from public.device_workouts where session_id = $1", [sessionId])).rows;
    expect(await read(athlete)).toEqual([{ status: "sent" }]);
    expect(await read(coach)).toEqual([{ status: "sent" }]);
    expect(await read(stranger)).toEqual([]);
    expect(await read(other)).toEqual([]);
  });

  it("aucune écriture par l'API, même par l'athlète", async () => {
    await expectFailure(as(athlete, "update public.device_workouts set status = 'failed', last_error = 'x' where session_id = $1", [sessionId]), DENIED);
    await expectFailure(as(athlete, "delete from public.device_workouts where session_id = $1", [sessionId]), DENIED);
    await expectFailure(
      as(athlete, "insert into public.device_workouts (connection_id, provider, athlete_id, segment_index, external_id, status, last_error) values ($1, 'suunto', $2, 1, $3, 'failed', 'x')", [
        connection,
        athlete.id,
        `tricoach-${sessionId}-1`,
      ]),
      DENIED,
    );
  });

  it("identifiant externe au format TriCoach, un envoi réussi a son identifiant Suunto, un échec sa raison", async () => {
    const insert = (externalId: string, status: string, guideId: string | null, error: string | null) =>
      asSuperuser(
        "insert into public.device_workouts (connection_id, provider, athlete_id, segment_index, external_id, status, remote_id, last_error, sent_at) values ($1, 'suunto', $2, 2, $3, $4, $5, $6, case when $4 = 'sent' then now() end)",
        [connection, athlete.id, externalId, status, guideId, error],
      );
    await expectFailure(insert("autre-chose", "failed", null, "x"), /device_workouts_external_id_check/);
    await expectFailure(insert(`tricoach-${sessionId}-2`, "sent", null, null), /device_workouts_outcome/);
    await expectFailure(insert(`tricoach-${sessionId}-2`, "failed", null, null), /device_workouts_outcome/);
    await insert(`tricoach-${sessionId}-2`, "failed", null, "Guide refusé par Suunto.");
    await expectFailure(insert(`tricoach-${sessionId}-2`, "failed", null, "x"), /device_workouts_external_unique/);
  });

  it("une séance supprimée laisse sa ligne (à retirer de la montre) ; la déconnexion efface tout", async () => {
    const extra = await insertSession(coach, athlete, { state: "published" });
    await asSuperuser(
      "insert into public.device_workouts (connection_id, provider, athlete_id, session_id, segment_index, external_id, remote_id, status, sent_at) values ($1, 'suunto', $2, $3, 0, $4, 'guide-2', 'sent', now())",
      [connection, athlete.id, extra.id, `tricoach-${extra.id}-0`],
    );
    await as(coach, "delete from public.planned_sessions where id = $1", [extra.id]);
    const left = await asSuperuser("select session_id from public.device_workouts where external_id = $1", [`tricoach-${extra.id}-0`]);
    expect(left.rows).toEqual([{ session_id: null }]);

    const temporary = await createUser({ name: "Athlète Suunto déconnecté" });
    const temporaryConnection = await connect(temporary, `suunto-${temporary.id.slice(0, 8)}`);
    const own = await insertSession(temporary, temporary, { state: "published" });
    await asSuperuser(
      "insert into public.device_workouts (connection_id, provider, athlete_id, session_id, segment_index, external_id, remote_id, status, sent_at) values ($1, 'suunto', $2, $3, 0, $4, 'guide-3', 'sent', now())",
      [temporaryConnection, temporary.id, own.id, `tricoach-${own.id}-0`],
    );
    await asSuperuser("delete from public.external_connections where id = $1", [temporaryConnection]);
    const gone = await asSuperuser("select count(*)::int as n from public.device_workouts where connection_id = $1", [temporaryConnection]);
    expect(gone.rows[0].n).toBe(0);
  });

  it("fournisseurs acceptés : Strava, intervals.icu et Suunto ; journaux et état du fournisseur aussi", async () => {
    await expectFailure(
      asSuperuser("insert into public.external_connections (athlete_id, provider, external_athlete_id) values ($1, 'garmin', 'x')", [other.id]),
      /external_connections_provider_check/,
    );
    await asSuperuser("insert into public.sync_logs (level, provider, event) values ('info', 'suunto', 'suunto_test')");
    await asSuperuser("insert into public.provider_state (provider) values ('suunto') on conflict (provider) do nothing");
    await asSuperuser("insert into public.sync_logs (level, provider, event) values ('info', 'intervals', 'intervals_test')");
  });
});
