import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, insertSession, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let unlinked: TestUser;
let coach: TestUser;
let outsider: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète Suunto" });
  unlinked = await createUser({ name: "Athlète sans Suunto" });
  coach = await createUser({ name: "Coach Suunto", coach: true });
  outsider = await createUser({ name: "Coach extérieur Suunto", coach: true });
  await linkCoach(coach, athlete);
  await linkCoach(coach, unlinked);
  // Le serveur (clé secrète) enregistre la connexion Suunto de l'athlète.
  await asSuperuser(
    `insert into public.external_connections (athlete_id, provider, external_athlete_id, scopes, status) values ($1, 'suunto', $2, '{guides}', 'active')`,
    [athlete.id, `suunto-${athlete.id.slice(0, 8)}`],
  );
});

afterAll(closeDb);

const jobs = async (sessionId: string) =>
  (
    await asSuperuser(`select kind, status, dedupe_key, payload from public.sync_jobs where payload->>'session_id' = $1 or dedupe_key = $2 order by id`, [
      sessionId,
      `suunto:remove:${sessionId}`,
    ])
  ).rows;

describe("Suunto : mise en file automatique", () => {
  it("une séance d'un athlète relié met un job d'envoi en file, une fois par version", async () => {
    const session = await insertSession(coach, athlete);
    let queued = await jobs(session.id);
    expect(queued).toEqual([
      expect.objectContaining({
        kind: "suunto_push",
        status: "pending",
        dedupe_key: `suunto:push:${session.id}:v1`,
      }),
    ]);

    // Même version retouchée deux fois : un seul job. Nouvelle version : un nouveau job.
    await as(coach, `update public.planned_sessions set title = 'Seuil v2' where id = $1`, [session.id]);
    const { rows } = await as(coach, `select version from public.planned_sessions where id = $1`, [session.id]);
    queued = await jobs(session.id);
    expect(queued).toHaveLength(Number(rows[0].version));
    expect(queued.at(-1)).toMatchObject({
      dedupe_key: `suunto:push:${session.id}:v${rows[0].version}`,
    });
  });

  it("rien n'est mis en file pour un athlète sans compte Suunto", async () => {
    const session = await insertSession(coach, unlinked);
    expect(await jobs(session.id)).toEqual([]);
  });

  it("l'annulation met en file (le serveur retirera le guide) ; la suppression recopie les identifiants des guides", async () => {
    const session = await insertSession(coach, athlete);
    await asSuperuser(
      `insert into public.suunto_guides (session_id, athlete_id, segment_index, guide_id, session_version, status, sent_at) values ($1, $2, 0, 'g-123', 1, 'sent', now())`,
      [session.id, athlete.id],
    );
    await as(coach, `update public.planned_sessions set state = 'cancelled' where id = $1`, [session.id]);
    expect((await jobs(session.id)).filter((j) => j.kind === "suunto_push").length).toBeGreaterThanOrEqual(2);

    await as(coach, `delete from public.planned_sessions where id = $1`, [session.id]);
    const removal = (await jobs(session.id)).find((j) => j.kind === "suunto_remove");
    expect(removal).toMatchObject({
      status: "pending",
      payload: { guide_ids: ["g-123"] },
    });
    // La ligne du guide est partie avec la séance.
    expect((await asSuperuser(`select 1 from public.suunto_guides where session_id = $1`, [session.id])).rows).toEqual([]);
  });

  it("la suppression d'une séance jamais envoyée ne met rien en file", async () => {
    const session = await insertSession(coach, athlete);
    await as(coach, `delete from public.planned_sessions where id = $1`, [session.id]);
    expect((await jobs(session.id)).some((j) => j.kind === "suunto_remove")).toBe(false);
  });
});

describe("Suunto : état des guides", () => {
  it("l'athlète et son coach lisent l'état, un coach étranger non, personne n'écrit par l'API", async () => {
    const session = await insertSession(coach, athlete);
    await asSuperuser(
      `insert into public.suunto_guides (session_id, athlete_id, segment_index, guide_id, session_version, status, issues) values ($1, $2, 0, 'g-1', 1, 'sent', '[{"severity":"loss","message":"Cadence en texte"}]')`,
      [session.id, athlete.id],
    );
    const mine = await as(athlete, `select status, issues from public.suunto_guides where session_id = $1`, [session.id]);
    expect(mine.rows).toEqual([
      {
        status: "sent",
        issues: [{ severity: "loss", message: "Cadence en texte" }],
      },
    ]);
    expect((await as(coach, `select status from public.suunto_guides where session_id = $1`, [session.id])).rows).toHaveLength(1);
    expect((await as(outsider, `select status from public.suunto_guides where session_id = $1`, [session.id])).rows).toEqual([]);
    // Sans politique d'écriture, la mise à jour ne touche aucune ligne et l'insertion est refusée.
    expect((await as(athlete, `update public.suunto_guides set status = 'removed' where session_id = $1`, [session.id])).rowCount).toBe(0);
    expect((await asSuperuser(`select status from public.suunto_guides where session_id = $1`, [session.id])).rows[0].status).toBe("sent");
    await expectFailure(
      as(athlete, `insert into public.suunto_guides (session_id, athlete_id, session_version, status) values ($1, $2, 1, 'sent')`, [session.id, athlete.id]),
      DENIED,
    );
  });

  it("un guide par partie de séance, avec un état connu", async () => {
    const session = await insertSession(coach, athlete);
    await asSuperuser(`insert into public.suunto_guides (session_id, athlete_id, segment_index, session_version, status) values ($1, $2, 0, 1, 'failed')`, [
      session.id,
      athlete.id,
    ]);
    await expectFailure(
      asSuperuser(`insert into public.suunto_guides (session_id, athlete_id, segment_index, session_version, status) values ($1, $2, 0, 1, 'sent')`, [
        session.id,
        athlete.id,
      ]),
      /suunto_guides_one_per_segment/,
    );
    await expectFailure(
      asSuperuser(`insert into public.suunto_guides (session_id, athlete_id, segment_index, session_version, status) values ($1, $2, 1, 1, 'pending')`, [
        session.id,
        athlete.id,
      ]),
      /status_check/,
    );
  });
});

describe("Suunto : séances de la fenêtre", () => {
  it("liste les séances publiées entre aujourd'hui et J+14, avec la version déjà envoyée", async () => {
    const who = await createUser({ name: "Athlète fenêtre" });
    await linkCoach(coach, who);
    const today = "2026-12-10";
    const inWindow = await insertSession(coach, who, { date: "2026-12-12" });
    const sent = await insertSession(coach, who, { date: "2026-12-20" });
    await insertSession(coach, who, { date: "2026-12-09" }); // passée
    await insertSession(coach, who, { date: "2026-12-25" }); // trop loin
    await insertSession(coach, who, { date: "2026-12-15", state: "draft" });
    await insertSession(coach, who, { date: "2026-12-15", state: "cancelled" });
    await asSuperuser(
      `insert into public.suunto_guides (session_id, athlete_id, segment_index, guide_id, session_version, status) values ($1, $2, 0, 'g', 1, 'sent')`,
      [sent.id, who.id],
    );

    const { rows } = await asSuperuser(`select * from public.suunto_sessions_to_push($1, $2::date, 14) order by session_id`, [who.id, today]);
    expect(rows.map((r) => [r.session_id, r.session_version, r.sent_version]).sort()).toEqual(
      [
        [inWindow.id, 1, null],
        [sent.id, 1, 1],
      ].sort(),
    );
    // Réservée au serveur.
    await expectFailure(as(who, `select * from public.suunto_sessions_to_push($1, $2::date, 14)`, [who.id, today]), /permission denied/);
  });
});
