import { afterAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, linkCoach } from "./helpers";

afterAll(closeDb);

describe("invitation coach → athlète", () => {
  it("parcours complet : le coach invite, l'athlète accepte, la relation est active", async () => {
    const coach = await createUser({ name: "Coach Léa", coach: true });
    const athlete = await createUser({ name: "Gérald" });

    const created = await as(coach, "select * from public.create_invitation($1, 48)", [athlete.email.toUpperCase()]);
    const { token, invitation_id } = created.rows[0];
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Le coach voit son invitation, l'adresse normalisée, mais jamais l'empreinte du jeton.
    const mine = await as(coach, "select id, email, accepted_at from public.invitations where id = $1", [invitation_id]);
    expect(mine.rows).toEqual([{ id: invitation_id, email: athlete.email, accepted_at: null }]);
    await expectFailure(as(coach, "select token_hash from public.invitations"), DENIED);

    // Aperçu visible avant connexion, grâce au jeton seul.
    const preview = await as(null, "select * from public.get_invitation_preview($1)", [token]);
    expect(preview.rows[0]).toMatchObject({ coach_name: "Coach Léa", status: "valid", email_bound: true });

    const accepted = await as(athlete, "select public.accept_invitation($1) as link_id", [token]);
    const linkId = accepted.rows[0].link_id;

    const link = await as(athlete, "select coach_id, status, can_edit_plan from public.coach_athlete_links where id = $1", [linkId]);
    expect(link.rows).toEqual([{ coach_id: coach.id, status: "active", can_edit_plan: true }]);

    // Le coach voit désormais le profil de l'athlète, et l'athlète celui du coach.
    const profileSeenByCoach = await as(coach, "select display_name from public.profiles where id = $1", [athlete.id]);
    expect(profileSeenByCoach.rows).toEqual([{ display_name: "Gérald" }]);
    const coachSeenByAthlete = await as(athlete, "select display_name from public.profiles where id = $1", [coach.id]);
    expect(coachSeenByAthlete.rows).toEqual([{ display_name: "Coach Léa" }]);

    // Le jeton ne sert qu'une fois.
    await expectFailure(as(athlete, "select public.accept_invitation($1)", [token]), /invitation_used/);
    const after = await as(null, "select status from public.get_invitation_preview($1)", [token]);
    expect(after.rows[0].status).toBe("used");
  });

  it("refuse une invitation adressée à quelqu'un d'autre", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const invited = await createUser({ name: "Invité" });
    const intruder = await createUser({ name: "Intrus" });
    const { rows } = await as(coach, "select * from public.create_invitation($1)", [invited.email]);
    await expectFailure(as(intruder, "select public.accept_invitation($1)", [rows[0].token]), /invitation_email_mismatch/);
  });

  it("exige une adresse confirmée pour une invitation nominative", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const unconfirmed = await createUser({ name: "Pas confirmé", confirmed: false });
    const { rows } = await as(coach, "select * from public.create_invitation($1)", [unconfirmed.email]);
    await expectFailure(as(unconfirmed, "select public.accept_invitation($1)", [rows[0].token]), /invitation_email_mismatch/);
  });

  it("accepte une invitation par lien, sans adresse imposée", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const athlete = await createUser({ name: "Athlète" });
    const { rows } = await as(coach, "select * from public.create_invitation()");
    await as(athlete, "select public.accept_invitation($1)", [rows[0].token]);
    const links = await as(coach, "select athlete_id from public.coach_athlete_links where status = 'active'");
    expect(links.rows).toEqual([{ athlete_id: athlete.id }]);
  });

  it("refuse les invitations expirées, révoquées, inconnues ou à soi-même", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const athlete = await createUser({ name: "Athlète" });

    const expired = await as(coach, "select * from public.create_invitation($1)", [athlete.email]);
    await asSuperuser(
      "update public.invitations set created_at = now() - interval '10 days', expires_at = now() - interval '1 day' where id = $1",
      [expired.rows[0].invitation_id],
    );
    await expectFailure(as(athlete, "select public.accept_invitation($1)", [expired.rows[0].token]), /invitation_expired/);

    const revoked = await as(coach, "select * from public.create_invitation($1)", [athlete.email]);
    await as(coach, "select public.revoke_invitation($1)", [revoked.rows[0].invitation_id]);
    await expectFailure(as(athlete, "select public.accept_invitation($1)", [revoked.rows[0].token]), /invitation_revoked/);

    await expectFailure(as(athlete, "select public.accept_invitation($1)", ["f".repeat(64)]), /invalid_invitation/);

    const own = await as(coach, "select * from public.create_invitation()");
    await expectFailure(as(coach, "select public.accept_invitation($1)", [own.rows[0].token]), /cannot_accept_own_invitation/);
  });

  it("réserve la création d'invitations aux comptes coach, et aux connectés", async () => {
    const notCoach = await createUser({ name: "Pas coach" });
    await expectFailure(as(notCoach, "select * from public.create_invitation()"), /not_a_coach/);
    await expectFailure(as(null, "select * from public.create_invitation()"), DENIED);
  });

  it("interdit d'écrire directement dans les invitations et les relations", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const athlete = await createUser({ name: "Athlète" });
    await expectFailure(
      as(coach, "insert into public.coach_athlete_links (coach_id, athlete_id) values ($1, $2)", [coach.id, athlete.id]),
      DENIED,
    );
    await expectFailure(
      as(coach, "insert into public.invitations (coach_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [
        coach.id,
        "a".repeat(64),
      ]),
      DENIED,
    );
  });
});

describe("relation coach-athlète", () => {
  it("l'athlète révoque son coach : l'accès disparaît immédiatement", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const athlete = await createUser({ name: "Athlète" });
    const linkId = await linkCoach(coach, athlete);
    await as(athlete, "update public.athlete_profiles set main_goal = 'Ironman' where user_id = $1", [athlete.id]);

    expect((await as(coach, "select 1 from public.athlete_profiles where user_id = $1", [athlete.id])).rowCount).toBe(1);
    await as(athlete, "select public.revoke_coach_link($1)", [linkId]);
    expect((await as(coach, "select 1 from public.athlete_profiles where user_id = $1", [athlete.id])).rowCount).toBe(0);
    expect((await as(coach, "select 1 from public.profiles where id = $1", [athlete.id])).rowCount).toBe(0);
  });

  it("une nouvelle invitation réactive une relation révoquée", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const athlete = await createUser({ name: "Athlète" });
    const first = await linkCoach(coach, athlete);
    await as(coach, "select public.revoke_coach_link($1)", [first]);
    const second = await linkCoach(coach, athlete);
    expect(second).toBe(first);
    const link = await as(athlete, "select status, revoked_at from public.coach_athlete_links where id = $1", [first]);
    expect(link.rows).toEqual([{ status: "active", revoked_at: null }]);
  });

  it("seul l'athlète règle les permissions de son coach", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const athlete = await createUser({ name: "Athlète" });
    const linkId = await linkCoach(coach, athlete);
    await expectFailure(as(coach, "select public.set_coach_permissions($1, true, true)", [linkId]), /link_not_found/);
    await as(athlete, "select public.set_coach_permissions($1, false, true)", [linkId]);
    const link = await as(coach, "select can_edit_plan from public.coach_athlete_links where id = $1", [linkId]);
    expect(link.rows).toEqual([{ can_edit_plan: false }]);
  });

  it("trace les changements de relation dans le journal d'audit", async () => {
    const coach = await createUser({ name: "Coach", coach: true });
    const athlete = await createUser({ name: "Athlète" });
    const linkId = await linkCoach(coach, athlete);
    await as(athlete, "select public.set_coach_permissions($1, false, false)", [linkId]);
    const log = await as(
      athlete,
      "select actor_id, action, changes from public.audit_logs where entity_id = $1 order by id",
      [linkId],
    );
    expect(log.rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(log.rows[1].actor_id).toBe(athlete.id);
    expect(log.rows[1].changes).toEqual({ can_edit_plan: [true, false], can_view_activities: [true, false] });
  });
});
