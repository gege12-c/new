import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  asSteps,
  asSuperuser,
  closeDb,
  createUser,
  DENIED,
  editableSnapshot,
  expectFailure,
  insertSession,
  linkCoach,
  type TestUser,
} from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let assistant: TestUser;
let outsider: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète planif" });
  coach = await createUser({ name: "Coach planif", coach: true });
  assistant = await createUser({ name: "Assistant", coach: true });
  outsider = await createUser({ name: "Coach extérieur", coach: true });
  await linkCoach(coach, athlete);
  await linkCoach(assistant, athlete);
});

afterAll(closeDb);

const save = (user: TestUser, id: string, base: object, values: object) =>
  as(user, "select public.save_planned_session($1, $2::jsonb, $3::jsonb) as row", [id, JSON.stringify(base), JSON.stringify(values)]);

describe("enregistrement fusionnant", () => {
  it("n'applique que les champs changés et incrémente la version", async () => {
    const session = await insertSession(coach, athlete, { state: "draft", title: "Seuil" });
    const base = await editableSnapshot(coach, session.id);
    const { rows } = await save(coach, session.id, base, { ...base, title: "Seuil long" });
    expect(rows[0].row.title).toBe("Seuil long");
    expect(rows[0].row.version).toBe(2);
    // Rien de changé : aucune écriture, version inchangée.
    const again = await save(coach, session.id, { ...base, title: "Seuil long" }, { ...base, title: "Seuil long" });
    expect(again.rows[0].row.version).toBe(2);
  });

  it("garde le déplacement fait par l'athlète pendant que le coach modifie le contenu", async () => {
    const session = await insertSession(coach, athlete, { state: "published", date: "2026-11-10" });
    const coachBase = await editableSnapshot(coach, session.id);
    const athleteBase = await editableSnapshot(athlete, session.id);
    await save(athlete, session.id, athleteBase, { ...athleteBase, scheduled_date: "2026-11-12" });

    const { rows } = await save(coach, session.id, coachBase, { ...coachBase, title: "Seuil 5 × 6 min" });
    expect(rows[0].row.scheduled_date).toBe("2026-11-12");
    expect(rows[0].row.title).toBe("Seuil 5 × 6 min");
  });

  it("refuse d'écraser un champ modifié entre-temps par quelqu'un d'autre", async () => {
    const session = await insertSession(coach, athlete, { state: "draft", title: "Départ" });
    const base = await editableSnapshot(coach, session.id);
    await save(assistant, session.id, base, { ...base, title: "Version de l'assistant" });
    await expectFailure(save(coach, session.id, base, { ...base, title: "Version du coach" }), /session_conflict/);
    const after = await editableSnapshot(coach, session.id);
    expect(after.title).toBe("Version de l'assistant");
  });

  it("respecte les droits : contenu interdit à l'athlète, séance invisible pour un coach extérieur", async () => {
    const session = await insertSession(coach, athlete, { state: "published" });
    const base = await editableSnapshot(athlete, session.id);
    await expectFailure(save(athlete, session.id, base, { ...base, title: "Plus court" }), /athlete_can_only_reschedule/);
    await expectFailure(save(outsider, session.id, base, { ...base, title: "Pirate" }), /session_not_found/);
    await expectFailure(save(coach, session.id, base, { ...base, state: "cancelled" }), /invalid_session_payload/);
  });
});

describe("modifications en attente d'une séance publiée", () => {
  it("restent invisibles pour l'athlète jusqu'à la publication", async () => {
    const session = await insertSession(coach, athlete, { state: "published", title: "Endurance 2 h" });
    const base = await editableSnapshot(coach, session.id);
    await as(coach, "select public.save_session_draft($1, $2::jsonb, $3::jsonb)", [
      session.id,
      JSON.stringify(base),
      JSON.stringify({ ...base, title: "Endurance 2 h 30" }),
    ]);

    expect((await as(athlete, "select title from public.planned_sessions where id = $1", [session.id])).rows[0].title).toBe("Endurance 2 h");
    expect((await as(athlete, "select 1 from public.planned_session_drafts where session_id = $1", [session.id])).rowCount).toBe(0);
    expect((await as(outsider, "select 1 from public.planned_session_drafts where session_id = $1", [session.id])).rowCount).toBe(0);

    const published = await as(coach, "select public.publish_session_draft($1) as row", [session.id]);
    expect(published.rows[0].row.title).toBe("Endurance 2 h 30");
    expect((await as(athlete, "select title from public.planned_sessions where id = $1", [session.id])).rows[0].title).toBe("Endurance 2 h 30");
    expect((await as(coach, "select 1 from public.planned_session_drafts where session_id = $1", [session.id])).rowCount).toBe(0);
  });

  const saveDraft = (user: TestUser, id: string, base: object, payload: object) =>
    as(user, "select public.save_session_draft($1, $2::jsonb, $3::jsonb) as result", [id, JSON.stringify(base), JSON.stringify(payload)]).then(
      (r) => r.rows[0].result as { payload: Record<string, unknown>; pending: boolean; updated_at: string | null },
    );
  const draftRow = (id: string) =>
    asSuperuser("select base, payload from public.planned_session_drafts where session_id = $1", [id]).then((r) => r.rows[0] ?? null);

  it("gardent leur base d'origine et détectent un conflit à la publication", async () => {
    const session = await insertSession(coach, athlete, { state: "published", date: "2026-11-20" });
    const base = await editableSnapshot(coach, session.id);
    const first = await saveDraft(coach, session.id, base, { ...base, scheduled_date: "2026-11-21" });
    expect(first.pending).toBe(true);
    // L'éditeur repart de ce qu'il a enregistré ; la base du brouillon reste la version publiée du début.
    await saveDraft(coach, session.id, first.payload, { ...first.payload, scheduled_date: "2026-11-22" });
    expect((await draftRow(session.id)).base.scheduled_date).toBe("2026-11-20");

    const athleteBase = await editableSnapshot(athlete, session.id);
    await save(athlete, session.id, athleteBase, { ...athleteBase, scheduled_date: "2026-11-23" });
    await expectFailure(as(coach, "select public.publish_session_draft($1)", [session.id]), /session_conflict/);
    // Rien n'est perdu : le brouillon du coach et le déplacement de l'athlète sont intacts.
    expect((await draftRow(session.id)).payload.scheduled_date).toBe("2026-11-22");
    expect((await editableSnapshot(coach, session.id)).scheduled_date).toBe("2026-11-23");

    // Le coach tranche en gardant sa date.
    const published = await as(coach, "select public.publish_session_draft($1, 'mine') as row", [session.id]);
    expect(published.rows[0].row.scheduled_date).toBe("2026-11-22");
    expect(await draftRow(session.id)).toBeNull();
  });

  it("se recalent sur la version publiée en gardant les autres modifications", async () => {
    const session = await insertSession(coach, athlete, { state: "published", date: "2026-11-24", title: "Seuil" });
    const base = await editableSnapshot(coach, session.id);
    await saveDraft(coach, session.id, base, { ...base, scheduled_date: "2026-11-25", title: "Seuil long" });
    const athleteBase = await editableSnapshot(athlete, session.id);
    await save(athlete, session.id, athleteBase, { ...athleteBase, scheduled_date: "2026-11-26", start_time: "07:00:00" });

    const rebased = await as(coach, "select public.rebase_session_draft($1, 'theirs') as result", [session.id]);
    const { payload, pending } = rebased.rows[0].result;
    expect(pending).toBe(true);
    expect(payload).toMatchObject({ scheduled_date: "2026-11-26", start_time: "07:00:00", title: "Seuil long" });
    expect((await draftRow(session.id)).base).toMatchObject({ scheduled_date: "2026-11-26", title: "Seuil" });

    const published = await as(coach, "select public.publish_session_draft($1) as row", [session.id]);
    expect(published.rows[0].row).toMatchObject({ scheduled_date: "2026-11-26", start_time: "07:00:00", title: "Seuil long" });
  });

  it("deux éditeurs ouverts sur la même séance ne s'écrasent pas", async () => {
    const session = await insertSession(coach, athlete, { state: "published", title: "Tempo" });
    const published = await editableSnapshot(coach, session.id);
    // Le coach et son assistant ont chargé la même version publiée.
    await saveDraft(coach, session.id, published, { ...published, title: "Tempo 3 × 10 min" });
    const merged = await saveDraft(assistant, session.id, published, { ...published, description: "Cadence haute" });
    expect(merged.payload).toMatchObject({ title: "Tempo 3 × 10 min", description: "Cadence haute" });

    // Un troisième éditeur, resté sur la version publiée, change le même titre : conflit, rien n'est écrit.
    await expectFailure(saveDraft(coach, session.id, published, { ...published, title: "Tempo 2 × 15 min" }), /session_conflict/);
    expect((await draftRow(session.id)).payload).toMatchObject({ title: "Tempo 3 × 10 min", description: "Cadence haute" });
  });

  it("disparaissent quand la séance redevient identique à la version publiée", async () => {
    const session = await insertSession(coach, athlete, { state: "published", title: "Footing" });
    const published = await editableSnapshot(coach, session.id);
    const changed = await saveDraft(coach, session.id, published, { ...published, title: "Footing vallonné" });
    expect(changed.pending).toBe(true);
    const reverted = await saveDraft(coach, session.id, changed.payload, { ...changed.payload, title: "Footing" });
    expect(reverted.pending).toBe(false);
    expect(await draftRow(session.id)).toBeNull();
  });

  it("ont toujours pour base la version publiée, jamais une valeur fournie", async () => {
    const session = await insertSession(coach, athlete, { state: "published", title: "Natation technique" });
    await expectFailure(
      as(coach, "insert into public.planned_session_drafts (session_id, base, payload) values ($1, '{}', '{}')", [session.id]),
      DENIED,
    );
    await as(coach, "insert into public.planned_session_drafts (session_id, payload) values ($1, '{\"title\": \"x\"}')", [session.id]);
    expect((await draftRow(session.id)).base).toEqual(await editableSnapshot(coach, session.id));
  });

  it("ne s'appliquent pas aux séances encore en brouillon", async () => {
    const session = await insertSession(coach, athlete, { state: "draft" });
    const base = await editableSnapshot(coach, session.id);
    await expectFailure(
      as(coach, "select public.save_session_draft($1, $2::jsonb, $3::jsonb)", [session.id, JSON.stringify(base), JSON.stringify(base)]),
      /session_is_draft/,
    );
  });
});

describe("commentaires", () => {
  it("partagés entre l'athlète et ses coachs, notes privées réservées à leur auteur", async () => {
    const session = await insertSession(coach, athlete, { state: "published" });
    await as(athlete, "insert into public.session_comments (session_id, body) values ($1, 'Jambes lourdes au 3e bloc')", [session.id]);
    await as(coach, "insert into public.session_comments (session_id, visibility, body) values ($1, 'coach_private', 'Réduire le volume ?')", [
      session.id,
    ]);
    const read = async (user: TestUser) =>
      (await as(user, "select visibility, body, athlete_id from public.session_comments where session_id = $1 order by created_at", [session.id]))
        .rows;

    expect((await read(coach)).map((c) => c.visibility)).toEqual(["shared", "coach_private"]);
    expect((await read(athlete)).map((c) => c.body)).toEqual(["Jambes lourdes au 3e bloc"]);
    expect((await read(assistant)).map((c) => c.visibility)).toEqual(["shared"]);
    expect(await read(outsider)).toEqual([]);
    expect((await read(coach))[0].athlete_id).toBe(athlete.id);
  });

  it("interdit les notes privées à l'athlète et les commentaires sur une séance invisible", async () => {
    const published = await insertSession(coach, athlete, { state: "published" });
    const draft = await insertSession(coach, athlete, { state: "draft" });
    await expectFailure(
      as(athlete, "insert into public.session_comments (session_id, visibility, body) values ($1, 'coach_private', 'x')", [published.id]),
      DENIED,
    );
    await expectFailure(as(athlete, "insert into public.session_comments (session_id, body) values ($1, 'x')", [draft.id]), DENIED);
    await expectFailure(as(outsider, "insert into public.session_comments (session_id, body) values ($1, 'x')", [published.id]), DENIED);
  });

  it("seul l'auteur modifie le texte ; la visibilité ne change pas", async () => {
    const session = await insertSession(coach, athlete, { state: "published" });
    const { rows } = await as(athlete, "insert into public.session_comments (session_id, body) values ($1, 'Fait') returning id", [session.id]);
    const id = rows[0].id;
    expect((await as(coach, "update public.session_comments set body = 'Modifié' where id = $1", [id])).rowCount).toBe(0);
    await expectFailure(as(athlete, "update public.session_comments set visibility = 'coach_private' where id = $1", [id]), DENIED);
    await as(athlete, "update public.session_comments set body = 'Fait, sensations bonnes' where id = $1", [id]);
    const after = await as(coach, "select body, edited_at from public.session_comments where id = $1", [id]);
    expect(after.rows[0].body).toBe("Fait, sensations bonnes");
    expect(after.rows[0].edited_at).not.toBeNull();
  });
});

describe("duplication et copie de semaine", () => {
  it("duplique une séance ; une séance annulée revient en brouillon", async () => {
    const published = await insertSession(coach, athlete, { state: "published", date: "2026-12-01" });
    const cancelled = await insertSession(coach, athlete, { state: "cancelled", date: "2026-12-02" });
    const copy = await as(coach, "select public.duplicate_planned_session($1, '2026-12-08') as id", [published.id]);
    const copyOfCancelled = await as(coach, "select public.duplicate_planned_session($1, '2026-12-09') as id", [cancelled.id]);
    const states = await as(coach, "select id, state, scheduled_date::text, created_by from public.planned_sessions where id = any($1)", [
      [copy.rows[0].id, copyOfCancelled.rows[0].id],
    ]);
    const byId = Object.fromEntries(states.rows.map((r) => [r.id, r]));
    expect(byId[copy.rows[0].id]).toMatchObject({ state: "published", scheduled_date: "2026-12-08", created_by: coach.id });
    expect(byId[copyOfCancelled.rows[0].id].state).toBe("draft");
    await expectFailure(as(outsider, "select public.duplicate_planned_session($1, '2026-12-10')", [published.id]), /session_not_found/);
  });

  it("copie une semaine jour pour jour, sans les séances annulées", async () => {
    // Semaine du lundi 4 janvier 2027.
    await insertSession(coach, athlete, { state: "published", date: "2027-01-04", title: "Lundi" });
    await insertSession(coach, athlete, { state: "draft", date: "2027-01-06", title: "Mercredi" });
    await insertSession(coach, athlete, { state: "cancelled", date: "2027-01-08", title: "Vendredi annulé" });
    await insertSession(coach, athlete, { state: "published", date: "2027-01-11", title: "Semaine suivante" });

    const copied = await as(coach, "select public.copy_planned_week($1, '2027-01-04', '2027-01-18') as count", [athlete.id]);
    expect(copied.rows[0].count).toBe(2);
    const target = await as(
      coach,
      "select title, scheduled_date::text, state from public.planned_sessions where athlete_id = $1 and scheduled_date between '2027-01-18' and '2027-01-24' order by scheduled_date",
      [athlete.id],
    );
    expect(target.rows).toEqual([
      { title: "Lundi", scheduled_date: "2027-01-18", state: "published" },
      { title: "Mercredi", scheduled_date: "2027-01-20", state: "draft" },
    ]);

    const asDrafts = await as(coach, "select public.copy_planned_week($1, '2027-01-04', '2027-01-25', 'draft') as count", [athlete.id]);
    expect(asDrafts.rows[0].count).toBe(2);
    await expectFailure(as(coach, "select public.copy_planned_week($1, '2027-01-05', '2027-01-18')", [athlete.id]), /week_must_start_monday/);
    // Un coach non autorisé ne voit rien à copier.
    expect((await as(outsider, "select public.copy_planned_week($1, '2027-01-04', '2027-02-01') as count", [athlete.id])).rows[0].count).toBe(0);
  });
});

describe("journal d'audit et brouillons", () => {
  it("cache à l'athlète l'historique d'une séance restée en brouillon", async () => {
    const session = await insertSession(coach, athlete, { state: "draft", title: "Secret" });
    const entries = (user: TestUser) =>
      as(user, "select action, visibility from public.audit_logs where entity_id = $1 order by id", [session.id]);
    expect((await entries(athlete)).rowCount).toBe(0);
    expect((await entries(coach)).rows).toEqual([{ action: "insert", visibility: "coaches" }]);

    await as(coach, "update public.planned_sessions set state = 'published' where id = $1", [session.id]);
    expect((await entries(athlete)).rows).toEqual([{ action: "update", visibility: "all" }]);
    expect((await entries(outsider)).rowCount).toBe(0);
  });
});

describe("temps réel", () => {
  const messagesFor = (sessionId: string) =>
    asSuperuser("select topic, event, private, payload from realtime.messages where payload ->> 'session_id' = $1 order by inserted_at", [
      sessionId,
    ]);

  it("signale les changements visibles par l'athlète, sans données de séance", async () => {
    const session = await insertSession(coach, athlete, { state: "draft", title: "Brouillon discret" });
    await as(coach, "insert into public.session_comments (session_id, body) values ($1, 'à préciser')", [session.id]);
    expect((await messagesFor(session.id)).rowCount).toBe(0);

    await as(coach, "update public.planned_sessions set state = 'published' where id = $1", [session.id]);
    const after = await messagesFor(session.id);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]).toMatchObject({ topic: `athlete:${athlete.id}`, event: "planning_changed", private: true });
    expect(after.rows[0].payload).toEqual({ table: "planned_sessions", op: "update", id: session.id, session_id: session.id });

    await as(coach, "insert into public.session_comments (session_id, visibility, body) values ($1, 'coach_private', 'note')", [session.id]);
    expect((await messagesFor(session.id)).rowCount).toBe(1);
    await as(athlete, "insert into public.session_comments (session_id, body) values ($1, 'ok')", [session.id]);
    expect((await messagesFor(session.id)).rowCount).toBe(2);
  });

  it("n'autorise l'écoute du canal qu'à l'athlète et à ses coachs", async () => {
    const topic = `athlete:${athlete.id}`;
    const visible = async (user: TestUser, channel: string) => {
      const [, result] = await asSteps(user, [
        { sql: "select set_config('realtime.topic', $1, true)", params: [channel] },
        { sql: "select count(*)::int as n from realtime.messages where topic = $1", params: [topic] },
      ]);
      return result.rows[0].n;
    };
    expect(await visible(athlete, topic)).toBeGreaterThan(0);
    expect(await visible(coach, topic)).toBeGreaterThan(0);
    expect(await visible(outsider, topic)).toBe(0);
    // Écouter son propre canal ne donne pas accès aux messages d'un autre.
    expect(await visible(outsider, `athlete:${outsider.id}`)).toBe(0);
    expect(await visible(athlete, "athlete:not-a-uuid")).toBe(0);
  });
});
