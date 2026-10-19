import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, expectFailure, insertSession, linkCoach, type TestUser } from "./helpers";

let admin: TestUser;
let coach: TestUser;
let athlete: TestUser;

beforeAll(async () => {
  admin = await createUser({ name: "Administratrice" });
  coach = await createUser({ name: "Coach admin", coach: true });
  athlete = await createUser({ name: "Athlète admin" });
  await asSuperuser("insert into public.admin_users (user_id) values ($1)", [admin.id]);
  await linkCoach(coach, athlete);
  await insertSession(coach, athlete);
});

afterAll(closeDb);

describe("comptes et rôles (administrateur)", () => {
  it("l'administrateur voit les comptes, leurs rôles et leurs relations, sans donnée sportive", async () => {
    const { rows, fields } = await as(admin, "select * from public.admin_accounts()");
    expect(fields.map((f) => f.name)).toEqual(["id", "display_name", "email", "is_coach", "is_admin", "created_at", "last_sign_in_at", "athletes", "coaches"]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[coach.id]).toMatchObject({ is_coach: true, is_admin: false, athletes: "1", coaches: "0", email: coach.email });
    expect(byId[athlete.id]).toMatchObject({ is_coach: false, coaches: "1" });
    expect(byId[admin.id]).toMatchObject({ is_admin: true });
  });

  it("personne d'autre n'y a accès", async () => {
    await expectFailure(as(coach, "select * from public.admin_accounts()"), /forbidden/);
    await expectFailure(as(coach, "select public.admin_set_admin($1, true)", [coach.id]), /forbidden/);
    await expectFailure(as(null, "select * from public.admin_accounts()"), /permission denied/);
  });

  it("donner et retirer le rôle d'administrateur ; jamais le dernier", async () => {
    await as(admin, "select public.admin_set_admin($1, true)", [coach.id]);
    expect((await as(coach, "select public.current_user_is_admin() as a")).rows[0].a).toBe(true);
    await as(coach, "select public.admin_set_admin($1, false)", [coach.id]);
    expect((await as(coach, "select public.current_user_is_admin() as a")).rows[0].a).toBe(false);
    const others = await asSuperuser("select count(*)::int as n from public.admin_users where user_id <> $1", [admin.id]);
    if (others.rows[0].n === 0) await expectFailure(as(admin, "select public.admin_set_admin($1, false)", [admin.id]), /last_admin/);
    await expectFailure(as(admin, "select public.admin_set_admin($1, true)", ["00000000-0000-4000-8000-000000000000"]), /account_not_found/);
  });
});
