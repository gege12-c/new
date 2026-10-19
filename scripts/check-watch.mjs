/**
 * Vérifications de l'application montre (watch/), sans le SDK Garmin : la compilation complète se
 * fait dans le workflow « Montre Garmin » quand les accès au SDK sont configurés (docs/GARMIN_WATCH.md).
 *
 * - syntaxe Monkey C de chaque fichier source (grammaire de @markw65/prettier-plugin-monkeyc) ;
 * - textes et images référencés (Rez.Strings, Rez.Drawables) présents dans les ressources ;
 * - vue rapide (glance) : seulement des textes marqués scope="glance" ;
 * - tâche de fond : ni écran ni ressource (indisponibles hors de l'application) ;
 * - textes affichables par les polices des montres (pas d'apostrophe courbe ni de « … ») ;
 * - manifeste : identifiant, permissions, montres sans doublon.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import * as monkeyc from "@markw65/prettier-plugin-monkeyc";

const root = fileURLToPath(new URL("../watch/", import.meta.url));
const problems = [];
const fail = (file, message) => problems.push(`${file} : ${message}`);

const sources = readdirSync(join(root, "source"))
  .filter((name) => name.endsWith(".mc"))
  .map((name) => ({ name, code: readFileSync(join(root, "source", name), "utf8") }));

for (const { name, code } of sources) {
  try {
    await prettier.format(code, { parser: "monkeyc", plugins: [monkeyc], filepath: name });
  } catch (error) {
    fail(name, `syntaxe : ${String(error.message).split("\n")[0]}`);
  }
}

const strings = readFileSync(join(root, "resources/strings/strings.xml"), "utf8");
const drawables = readFileSync(join(root, "resources/drawables/drawables.xml"), "utf8");
const stringIds = new Map([...strings.matchAll(/<string id="(\w+)"([^>]*)>([^<]*)<\/string>/g)].map((m) => [m[1], { glance: /scope="glance"/.test(m[2]), text: m[3] }]));
const drawableIds = new Set([...drawables.matchAll(/<bitmap id="(\w+)"/g)].map((m) => m[1]));

for (const { name, code } of sources) {
  for (const [, id] of code.matchAll(/Rez\.Strings\.(\w+)/g)) if (!stringIds.has(id)) fail(name, `texte inconnu Rez.Strings.${id}`);
  for (const [, id] of code.matchAll(/Rez\.Drawables\.(\w+)/g)) if (!drawableIds.has(id)) fail(name, `image inconnue Rez.Drawables.${id}`);
}

// Vue rapide : un processus à part, qui ne charge que ce qui est marqué pour lui.
for (const { name, code } of sources.filter((s) => /\bextends WatchUi\.GlanceView\b/.test(s.code))) {
  for (const [, id] of code.matchAll(/Rez\.Strings\.(\w+)/g)) if (stringIds.get(id) && !stringIds.get(id).glance) fail(name, `texte ${id} sans scope="glance"`);
}

// Tâche de fond : pas d'écran ni de ressource.
for (const { name, code } of sources.filter((s) => /\bextends System\.ServiceDelegate\b/.test(s.code))) {
  if (/\bWatchUi\.|\bRez\./.test(code)) fail(name, "la tâche de fond ne peut utiliser ni WatchUi ni les ressources");
  if (!/^\(:background\)/m.test(code)) fail(name, "classe de tâche de fond sans (:background)");
}
for (const { name, code } of sources.filter((s) => /\bmodule (Store|Config)\b/.test(s.code) || /\bextends Application\.AppBase\b/.test(s.code))) {
  if (!/^\(:glance, :background\)/m.test(code)) fail(name, "doit être marqué (:glance, :background) : utilisé par la vue rapide et la tâche de fond");
}

/** Corps d'un bloc { … } qui suit la position donnée (accolades équilibrées). */
function blockAfter(code, start) {
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    if (code[i] === "}" && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

// La classe de l'application est chargée par la vue rapide et la tâche de fond : pas de ressource.
for (const { name, code } of sources) {
  const match = /class \w+ extends Application\.AppBase/.exec(code);
  if (match && /\bRez\./.test(blockAfter(code, match.index))) fail(name, "la classe de l'application ne doit pas utiliser de ressource (Rez) : elle sert aussi à la vue rapide et à la tâche de fond");
}

// Retour : jamais de popView dans un BehaviorDelegate. Ces délégués servent aux premiers écrans, où
// popView lève une exception sur les widgets Connect IQ 3 ; le retour par défaut fait le nécessaire.
for (const { name, code } of sources) {
  for (const match of code.matchAll(/class (\w+) extends WatchUi\.BehaviorDelegate/g)) {
    if (/\bpopView\b/.test(blockAfter(code, match.index))) fail(name, `${match[1]} : pas de popView dans un BehaviorDelegate (refusé sur le premier écran d'un widget)`);
  }
}

// Minuteries : rappel déclaré « as Void », comme l'attend Timer.start.
for (const { name, code } of sources) {
  for (const [, callback] of code.matchAll(/\.start\(method\(:(\w+)\)/g)) {
    if (!new RegExp(`function ${callback}\\(\\) as Void`).test(code)) fail(name, `rappel de minuterie ${callback} : à déclarer « function ${callback}() as Void »`);
  }
}

// Polices des montres : apostrophe droite, trois points.
for (const [id, { text }] of stringIds) {
  if (/[’‘“”…–—]/.test(text)) fail("strings.xml", `${id} : signe typographique non affichable (’ “ ” … – —)`);
  if (/[^\n -~ -ÿ]/u.test(text.replaceAll("\\n", "\n"))) fail("strings.xml", `${id} : caractère hors des polices des montres`);
}

const manifest = readFileSync(join(root, "manifest.xml"), "utf8");
if (!/<iq:application id="[0-9a-f]{32}"/.test(manifest)) fail("manifest.xml", "identifiant d'application attendu : 32 caractères hexadécimaux");
for (const permission of ["Background", "Communications", "PersistedContent"]) {
  if (!manifest.includes(`<iq:uses-permission id="${permission}"/>`)) fail("manifest.xml", `permission ${permission} manquante`);
}
const products = [...manifest.matchAll(/<iq:product id="([\w]+)"\/>/g)].map((m) => m[1]);
if (products.length === 0) fail("manifest.xml", "aucune montre");
const duplicates = products.filter((id, index) => products.indexOf(id) !== index);
if (duplicates.length) fail("manifest.xml", `montres en double : ${duplicates.join(", ")}`);

if (problems.length) {
  console.error(`Application montre : ${problems.length} problème(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Application montre : ${sources.length} fichiers Monkey C, ${stringIds.size} textes, ${products.length} montres, rien à signaler.`);
