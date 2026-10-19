#!/usr/bin/env node
/**
 * Contrôle de la production, sans compte ni secret : l'application répond et joint Supabase, la
 * version déployée est la bonne, les pages publiques et les fichiers de l'application installable
 * sont servis, les en-têtes de sécurité sont présents et les API refusent un visiteur anonyme.
 *
 * Usage : node scripts/production-smoke.mjs [adresse] [commit attendu]
 */
const [base = "https://new-bay-one-76.vercel.app", expectedCommit] = process.argv.slice(2);
const failures = [];

function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "ÉCHEC"} ${label}${detail ? ` : ${detail}` : ""}`);
  if (ok) return;
  failures.push(label);
  // Dans GitHub Actions, chaque échec devient une annotation lisible sans ouvrir le journal.
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Production::${label}${detail ? ` : ${detail.replaceAll("\n", " ")}` : ""}`);
}

async function get(path) {
  const url = new URL(path, base);
  url.searchParams.set("smoke", String(Date.now()));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, { redirect: "manual", headers: { "cache-control": "no-cache" } });
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// Vercel annonce le déploiement terminé un peu avant de basculer l'adresse de production : on attend
// que la version servie soit celle attendue (3 minutes au plus) avant de tout contrôler.
let health = await get("/api/health");
let report = await health.json().catch(() => null);
for (let waited = 0; expectedCommit && report?.commit !== expectedCommit.slice(0, 7) && waited < 180; waited += 10) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  health = await get("/api/health");
  report = await health.json().catch(() => null);
}
check(health.status === 200 && report?.ok === true && report?.supabase === "ok", "santé et Supabase (/api/health)", JSON.stringify(report));
if (expectedCommit) check(report?.commit === expectedCommit.slice(0, 7), "version déployée", `${report?.commit ?? "inconnue"}, attendue ${expectedCommit.slice(0, 7)}`);
check(report?.auth?.signup === "enabled", "inscriptions ouvertes");

const login = await get("/login");
const html = await login.text();
check(login.status === 200 && html.includes("Connexion"), "page de connexion");
check(login.headers.get("x-frame-options") === "DENY", "en-tête X-Frame-Options");
check(login.headers.get("x-content-type-options") === "nosniff", "en-tête X-Content-Type-Options");
check(login.headers.get("referrer-policy") === "strict-origin-when-cross-origin", "en-tête Referrer-Policy");
check((login.headers.get("permissions-policy") ?? "").includes("camera=()"), "en-tête Permissions-Policy");
check((login.headers.get("strict-transport-security") ?? "").includes("max-age"), "HTTPS imposé (HSTS)");

const manifest = await get("/manifest.webmanifest");
const app = await manifest.json().catch(() => null);
check(manifest.status === 200 && app?.name === "TriCoach" && app?.display === "standalone", "manifeste de l'application installable");
for (const icon of app?.icons ?? []) {
  const response = await get(icon.src);
  check(response.status === 200 && (response.headers.get("content-type") ?? "").startsWith("image/"), `icône ${icon.sizes} ${icon.purpose ?? "any"}`);
}
const worker = await get("/sw.js");
check(worker.status === 200 && (worker.headers.get("content-type") ?? "").includes("javascript"), "service worker");
const offline = await get("/offline.html");
check(offline.status === 200, "page hors connexion");

const home = await get("/home");
check([302, 303, 307, 308].includes(home.status) && (home.headers.get("location") ?? "").includes("/login"), "espace connecté réservé (redirection vers la connexion)");
const exportApi = await get("/api/me/export");
check(exportApi.status === 401, "export des données refusé sans connexion");
const cron = await get("/api/cron/daily");
check(cron.status === 401 || cron.status === 503, "tâche quotidienne refusée sans secret", String(cron.status));

console.log(failures.length ? `\n${failures.length} contrôle(s) en échec.` : "\nProduction conforme.");
process.exit(failures.length ? 1 : 0);
