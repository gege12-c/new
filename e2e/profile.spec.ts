/**
 * Invitation et profil sportif par les formulaires, comme un utilisateur les remplit (les autres
 * tests préparent ces données par l'API) : le coach crée un lien d'invitation, une athlète crée son
 * compte depuis ce lien sur son téléphone et l'accepte ; elle renseigne ses seuils, une
 * compétition, ses objectifs, ses réglages et les permissions de son coach ; le coach saisit un
 * seuil pour elle ; elle retire enfin l'accès du coach.
 */
import { devices, expect, test, type Page } from "@playwright/test";
import { accounts, addDays, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

const panel = (page: Page, title: string) => page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });

test("inviter une athlète, puis remplir chaque formulaire du profil sportif", async ({ browser }) => {
  const { coach, password } = accounts();
  const email = `invitee-${Date.now()}@e2e.local`;

  // Le coach crée un lien réservé à cette adresse.
  const coachPage = await signedIn(browser, "coach");
  await coachPage.goto("/coach");
  // Un formulaire modifié, ou resté ouvert sur une ancienne version du site : le serveur refuse,
  // en français (messages de validation par défaut installés au démarrage du serveur).
  await coachPage.locator("#invite-validity option[value='30']").evaluate((option) => ((option as HTMLOptionElement).value = "45"));
  await coachPage.locator("#invite-validity").selectOption("45");
  await coachPage.getByRole("button", { name: "Créer le lien" }).click();
  await expect(coachPage.getByText("Valeur maximale : 30.")).toBeVisible();
  await coachPage.reload();
  await coachPage.getByLabel("Email de l’athlète (facultatif)").fill(email);
  await coachPage.getByRole("button", { name: "Créer le lien" }).click();
  await expect(coachPage.getByText("Lien d’invitation prêt")).toBeVisible();
  const link = (await coachPage.getByText(/\/invite\/[\w-]{32,}/).textContent())!.trim();

  // L'athlète ouvre le lien sur son téléphone, crée son compte et accepte.
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: `${coach.name} vous invite` })).toBeVisible();
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await page.getByLabel("Nom affiché").fill("Invitée E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.getByRole("button", { name: `Accepter et donner accès à ${coach.name}` }).click();
  await expect(page).toHaveURL(/\/athlete\?joined=1/);
  // Le lien ne sert qu'une fois.
  await page.goto(new URL(link).pathname);
  await expect(page.getByText("Cette invitation a déjà été utilisée.")).toBeVisible();

  // Seuils : FTP (le formulaire du 19 octobre), puis une allure, d'abord mal écrite.
  await page.goto("/athlete/profile");
  const thresholds = panel(page, "Seuils");
  await expect(thresholds.getByText("Aucun seuil renseigné")).toBeVisible();
  await expect(thresholds.getByLabel("Seuil", { exact: true })).toHaveValue("bike.ftp_w");
  await thresholds.getByLabel("Valeur (W)").fill("275");
  await thresholds.getByRole("button", { name: "Enregistrer le seuil" }).click();
  await expect(thresholds.getByText("Seuil enregistré : FTP (vélo).")).toBeVisible();
  await expect(thresholds.getByText("275 W").first()).toBeVisible();
  await expect(thresholds.getByLabel("Valeur (W)")).toHaveValue("");

  await thresholds.getByLabel("Seuil", { exact: true }).selectOption("run.threshold_pace_s_per_km");
  const pastDay = addDays(isoDay(0), -3);
  await thresholds.getByLabel("À partir du").fill(pastDay);
  await thresholds.getByLabel("Valeur (/km)").fill("4h10");
  await thresholds.getByRole("button", { name: "Enregistrer le seuil" }).click();
  await expect(thresholds.getByText("Allure illisible : utilisez le format min:s, par exemple 4:10.")).toBeVisible();
  // Rien de ce qui a été saisi n'est perdu après une erreur.
  await expect(thresholds.getByLabel("Valeur (/km)")).toHaveValue("4h10");
  await expect(thresholds.getByLabel("À partir du")).toHaveValue(pastDay);
  await thresholds.getByLabel("Valeur (/km)").fill("4:10");
  await thresholds.getByRole("button", { name: "Enregistrer le seuil" }).click();
  await expect(thresholds.getByText("Seuil enregistré : Allure seuil (course à pied).")).toBeVisible();
  await expect(thresholds.getByText("4:10 /km").first()).toBeVisible();

  await thresholds.getByLabel("Seuil", { exact: true }).selectOption("general.weight_kg");
  await thresholds.getByLabel("Valeur (kg)").fill("900");
  await thresholds.getByRole("button", { name: "Enregistrer le seuil" }).click();
  await expect(thresholds.getByText("Poids : valeur hors limites.")).toBeVisible();
  await thresholds.getByLabel("Valeur (kg)").fill("72,5");
  await thresholds.getByRole("button", { name: "Enregistrer le seuil" }).click();
  await expect(thresholds.getByText("Seuil enregistré : Poids (général).")).toBeVisible();
  await expect(thresholds.getByText("72,5 kg").first()).toBeVisible();
  await expect(page.getByText(/Invalid input|expected|received/)).toHaveCount(0);

  // Compétition.
  const events = panel(page, "Compétitions");
  const raceDay = addDays(isoDay(0), 120);
  await events.getByLabel("Nom").fill("Ironman Nice");
  await events.getByLabel("Date").fill(raceDay);
  await events.getByLabel("Priorité").selectOption("A");
  await events.getByLabel("Format").fill("Ironman");
  await events.getByLabel("Lieu").fill("Nice");
  await events.getByRole("button", { name: "Ajouter la compétition" }).click();
  await expect(events.getByText("Compétition ajoutée.")).toBeVisible();
  await expect(events.getByText("J-120")).toBeVisible();

  // Objectifs : une erreur ne fait rien perdre, puis l'enregistrement.
  const goals = panel(page, "Objectifs");
  await goals.getByLabel("Objectif principal").fill("Se qualifier pour Kona");
  await goals.getByLabel("Volume visé (h par semaine)").fill("50");
  await goals.getByLabel("Informations pour le coach").fill("Pilote : vols du lundi au jeudi.");
  await goals.getByRole("button", { name: "Enregistrer les objectifs" }).click();
  await expect(goals.getByText("Volume hebdomadaire : entre 0 et 40 heures.")).toBeVisible();
  await expect(goals.getByLabel("Objectif principal")).toHaveValue("Se qualifier pour Kona");
  await expect(goals.getByLabel("Informations pour le coach")).toHaveValue("Pilote : vols du lundi au jeudi.");
  await goals.getByLabel("Volume visé (h par semaine)").fill("12,5");
  await goals.getByRole("button", { name: "Enregistrer les objectifs" }).click();
  await expect(goals.getByText("Objectifs enregistrés.")).toBeVisible();
  await page.reload();
  await expect(goals.getByLabel("Volume visé (h par semaine)")).toHaveValue("12,5");
  await expect(goals.getByLabel("Objectif principal")).toHaveValue("Se qualifier pour Kona");

  // Réglages du compte : la nouvelle valeur reste affichée après l'enregistrement.
  await page.goto("/settings");
  await page.getByLabel("Nom affiché").fill("Invitée Réglée");
  await page.getByRole("button", { name: "Enregistrer les réglages" }).click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  await expect(page.getByLabel("Nom affiché")).toHaveValue("Invitée Réglée");

  // Le coach voit son athlète (nom, objectif) et saisit un seuil pour elle.
  await coachPage.goto("/coach");
  const row = coachPage.getByRole("link", { name: /Invitée Réglée/ });
  await expect(row).toContainText("Se qualifier pour Kona");
  const athletePath = await row.getAttribute("href");
  await coachPage.goto(`${athletePath}/profile`);
  const coachThresholds = panel(coachPage, "Seuils");
  await expect(coachThresholds.getByText("275 W").first()).toBeVisible();
  await coachThresholds.getByLabel("Seuil", { exact: true }).selectOption("bike.lthr_bpm");
  await coachThresholds.getByLabel("Valeur (bpm)").fill("168");
  await coachThresholds.getByRole("button", { name: "Enregistrer le seuil" }).click();
  await expect(coachThresholds.getByText("Seuil enregistré : FC au seuil (vélo).")).toBeVisible();
  await expect(panel(coachPage, "Compétitions").getByText("Ironman Nice")).toBeVisible();

  // Permissions, puis retrait de l'accès : le coach ne voit plus l'athlète.
  await page.goto("/athlete/profile");
  const myCoach = panel(page, "Mon coach");
  await expect(panel(page, "Seuils").getByText("168 bpm").first()).toBeVisible();
  await myCoach.getByLabel("Peut voir mes activités importées").uncheck();
  await myCoach.getByRole("button", { name: "Enregistrer les permissions" }).click();
  await expect(myCoach.getByText("Permissions mises à jour.")).toBeVisible();
  await expect(myCoach.getByLabel("Peut voir mes activités importées")).not.toBeChecked();
  await expect(myCoach.getByLabel("Peut planifier mes séances")).toBeChecked();
  page.once("dialog", (dialog) => dialog.accept());
  await myCoach.getByRole("button", { name: "Retirer l’accès" }).click();
  await expect(myCoach.getByText("Pas encore de coach")).toBeVisible();
  await coachPage.goto("/coach");
  await expect(coachPage.getByRole("link", { name: /Invitée Réglée/ })).toHaveCount(0);

  await context.close();
  await coachPage.context().close();
});
