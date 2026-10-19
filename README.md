# TriCoach

Plateforme de coaching triathlon : le coach programme sur le Web, l'athlète retrouve ses séances sur son téléphone, mises à jour en direct, les exporte vers ses appareils (Zwift, Garmin), et ses activités réelles (Strava, fichiers FIT) sont comparées au prévu.
Next.js 16 (TypeScript) + Supabase (PostgreSQL, Auth, RLS, Realtime), déployé sur Vercel.

État d'avancement : [docs/STATUS.md](docs/STATUS.md). Cahier des charges : [CLAUDE.md](CLAUDE.md).

## Mise en ligne

| | |
| --- | --- |
| Application | https://new-bay-one-76.vercel.app (projet Vercel `new`) |
| Base | Supabase `supabase-rose-candle`, référence `ugqtfkuisaqjdnwxvogm`, Zurich |
| État en direct | https://new-bay-one-76.vercel.app/api/health |

Chaque push sur `main` redéploie l'application. Les fonctions Vercel tournent à Francfort (`vercel.json`), au plus près de la base. La page `/api/health` indique si l'URL et la clé Supabase du déploiement sont valides (`"supabase": "ok"`) et si la confirmation d'email est exigée (`"emailConfirmation"`) ; elle n'affiche que des informations déjà publiques.

### 1. Projet Vercel (fait)

Variables d'environnement du projet (Production et Preview) :

| Variable | Valeur |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ugqtfkuisaqjdnwxvogm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la clé publishable du projet (`sb_publishable_…`), dans les clés d'API Supabase |

Les variables de l'intégration Supabase de Vercel (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) sont reconnues aussi. Les pages n'utilisent que la clé publishable : la sécurité repose sur les règles d'accès de la base.

Variables serveur des activités (phase 3), environnement **Production**, à saisir vous-même dans Vercel (Settings, Environment Variables) ; aucune ne doit être copiée ailleurs :

| Variable | Où la trouver |
| --- | --- |
| `SUPABASE_SECRET_KEY` | Supabase, Project Settings, API Keys : clé secrète (`sb_secret_…`). Sert uniquement à la file de synchronisation (jetons Strava, jobs), jamais dans une page |
| `STRAVA_CLIENT_ID` et `STRAVA_CLIENT_SECRET` | votre application Strava, sur strava.com/settings/api (voir ci-dessous) |
| `TOKEN_ENCRYPTION_KEY` | page **Administration** de TriCoach, bouton « Générer des valeurs » (32 octets en base64). À ne plus changer ensuite |
| `CRON_SECRET` | même page, même bouton. Vercel l'envoie à la synchronisation quotidienne (`vercel.json`, 3 h 20 UTC) |

Sans elles, Strava est affiché « non configuré » et seul l'import de fichiers FIT fonctionne. Après les avoir ajoutées, relancez un déploiement (Deployments, dernier déploiement, « Redeploy »).

Pour recréer le projet : importez le dépôt `gege12-c/new` sur [vercel.com](https://vercel.com), ajoutez les deux variables, puis vérifiez dans l'onglet Deployments qu'un déploiement a bien démarré (sans déploiement, l'adresse affiche « 404 DEPLOYMENT_NOT_FOUND »).

### 2. Régler l'authentification Supabase

Le tableau de bord Supabase s'ouvre depuis Vercel (onglet Storage, base `supabase-rose-candle`, bouton « Open in Supabase ») ou directement sur supabase.com. Dans **Authentication** :

- **URL Configuration** : *Site URL* = `https://new-bay-one-76.vercel.app` ; dans *Redirect URLs*, ajoutez `https://new-bay-one-76.vercel.app/**` (et `http://localhost:3000/**` pour le développement). Sans cela, les liens reçus par email renvoient vers `localhost`.
- **Sign In / Providers**, section Email : désactivez **Confirm email**, puis enregistrez. Tant qu'aucun service d'envoi d'emails (SMTP) n'est configuré, Supabase n'envoie d'emails qu'aux membres de l'organisation du projet : vos athlètes ne pourraient pas confirmer leur compte. Réactivez-la après avoir configuré un service d'envoi. Le mot de passe oublié reste limité aux membres de l'organisation d'ici là.

Contrôle : `/api/health` affiche alors `"emailConfirmation": "disabled"`.

### 3. Vérifier le parcours coach → athlète

1. Créez un compte en cochant « J'entraîne des athlètes ».
2. Dans « Mes athlètes », créez un lien d'invitation (avec l'email de l'athlète, ou sans).
3. Ouvrez le lien dans une fenêtre de navigation privée, créez le compte athlète et acceptez l'invitation.
4. Côté coach, l'athlète apparaît : ouvrez sa fiche et ajoutez une FTP. Côté athlète, elle apparaît dans « Profil sportif ».

### Devenir administrateur

Dans l'éditeur SQL Supabase :

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'votre-adresse@exemple.fr'
returning user_id;
```

Résultat attendu : une ligne. « Success. No rows returned » veut dire que l'adresse ne correspond à aucun compte. Un administrateur voit la configuration des intégrations, la file de synchronisation et le journal technique (page **Administration**), jamais les données sportives.

### 4. Activer Strava

1. Sur strava.com/settings/api (connecté à votre compte Strava), créez l'application : un nom sans le mot « Strava » (règles de marque), catégorie « Training », site `https://new-bay-one-76.vercel.app`, **Authorization Callback Domain** `new-bay-one-76.vercel.app`. Depuis juin 2026, Strava exige un abonnement Strava actif sur le compte qui crée l'application.
2. Saisissez dans Vercel les variables ci-dessus, puis relancez un déploiement. `TOKEN_ENCRYPTION_KEY` et `CRON_SECRET` se génèrent sur la page **Administration** : devenez d'abord administrateur (ci-dessus).
3. Ouvrez TriCoach, page **Administration** : les quatre lignes doivent être vertes. Cliquez sur « Activer la réception des activités » (Strava vérifie aussitôt l'adresse `/api/strava/webhook`).
4. Côté athlète : **Profil sportif**, carte « Activités réalisées », « Connecter Strava ». Les activités des 7 derniers jours arrivent, puis chaque nouvelle activité en quelques minutes.
5. Une nouvelle application Strava démarre en « single-player mode » : seul votre propre compte peut s'y connecter. Depuis son tableau de bord (API Settings), passez à la capacité de 10 athlètes, sans revue ([documentation Strava](https://developers.strava.com/docs/getting-started/)). Au-delà de 10, Strava demande une revue.

Règles de Strava appliquées : les activités Strava ne sont visibles que de l'athlète, et du coach qu'il autorise expressément (profil sportif, « Mon coach », « Activités Strava » ; désactivé par défaut, retirable à tout moment) ; elles n'entrent dans aucune statistique, elles sont effacées au bout de 6 jours (7 au plus autorisés), une suppression sur Strava est répercutée sous 48 h, et une déconnexion efface tout aussitôt. Aucune donnée Strava n'est transmise à un outil d'IA.

### Contrôle automatique de la production

Après chaque déploiement de `main` réussi, le workflow GitHub « Production » lance `node scripts/production-smoke.mjs` contre le site en ligne : santé et Supabase (`/api/health`), version déployée, page de connexion, en-têtes de sécurité, HTTPS imposé, manifeste, icônes et service worker, refus des visiteurs anonymes. Aucun compte ni secret n'est utilisé ; il se lance aussi à la main (Actions > Production > Run workflow).

### Mettre à jour la base de production

Les migrations pas encore appliquées en production (en ce moment celles des phases 3, 4 et 5) sont réunies dans un seul fichier, [`supabase/production/pending.sql`](supabase/production/pending.sql), généré par `node scripts/production-sql.mjs` à partir de `supabase/migrations` (la CI vérifie qu'il est à jour et qu'il s'applique en une fois). Pour l'appliquer : ouvrez sa version brute sur GitHub, copiez tout le texte, puis Supabase > **SQL Editor** > **New query**, collez et cliquez sur **Run** (si Supabase signale une « destructive operation », confirmez : ce sont des fonctions qui effacent sur demande, rien n'est supprimé à l'application du fichier). Résultat attendu : « Success. No rows returned ». C'est tout ou rien : en cas d'erreur, la base reste inchangée. Une fois la mise à jour faite, les versions passent dans `supabase/production/applied.txt` et le fichier est régénéré.

### Sauvegardes

L'offre gratuite de Supabase ne comprend pas de sauvegarde automatique ; Supabase recommande d'exporter régulièrement ses données ([documentation](https://supabase.com/docs/guides/platform/backups)). L'offre Pro garde les 7 dernières sauvegardes quotidiennes. Export manuel, depuis un ordinateur :

```bash
npx supabase login
npx supabase link --project-ref ugqtfkuisaqjdnwxvogm
npx supabase db dump -f tricoach-schema.sql
npx supabase db dump --data-only -f tricoach-donnees.sql
```

Gardez ces fichiers hors du dépôt GitHub (il est public) : ils contiennent les données des athlètes.

Chaque utilisateur peut aussi télécharger ses propres données depuis ses réglages (« Vos données ») : c'est son droit d'accès, pas une sauvegarde de la base.

### Nouveau projet Supabase (développement, test)

Appliquez les fichiers de [`supabase/migrations`](supabase/migrations) dans l'ordre de leur nom, soit en les collant un par un dans l'éditeur SQL, soit avec la CLI :

```bash
npx supabase login
npx supabase link --project-ref <référence-du-projet>
npx supabase db push
```

Les noms de fichiers reprennent les versions enregistrées sur la base de production : `db push` n'y rejoue donc rien.

## Développement

Prérequis : Node.js 22 ou plus, et PostgreSQL 16 installé localement pour les tests de base de données.

```bash
npm install
cp .env.example .env.local   # puis renseignez l'URL et la clé Supabase de développement
npm run dev                  # http://localhost:3000
```

| Commande | Rôle |
| --- | --- |
| `npm test` | tests unitaires et tests de sécurité de la base |
| `npm run test:unit` | format de séance, calculs, utilitaires |
| `npm run test:db` | migrations et politiques RLS sur un PostgreSQL jetable |
| `npm run lint` / `npm run typecheck` | qualité du code |
| `npm run db:types` | régénère les types TypeScript de la base après une migration |
| `npm run test:integration` | chaîne Strava complète et lectures du réalisé, contre une pile Supabase démarrée (variables de `.env.local-stack`) et un faux Strava |
| `npm run test:e2e` | parcours clés dans un navigateur (Playwright), contre l'application lancée sur `http://localhost:3000` |
| `npm run watch:check` | application de la montre Garmin (`watch/`) : syntaxe Monkey C, textes et manifeste, sans le SDK Garmin (compilation complète : workflow « Montre Garmin », [docs/GARMIN_WATCH.md](docs/GARMIN_WATCH.md)) |

Les tests de base démarrent un PostgreSQL temporaire (binaires trouvés automatiquement, ou `PG_BIN`) ; avec `TEST_DATABASE_URL`, ils utilisent ce serveur à la place.

### Pile Supabase locale et tests de bout en bout

Deux façons de faire tourner Supabase sur sa machine :

- **Avec Docker** (pile officielle, Realtime compris) : `npx supabase start` lit `supabase/config.toml` et applique les migrations. `npx supabase status` donne l'URL et la clé `anon` à mettre dans `.env.local`. C'est ce que fait la CI pour les tests de bout en bout, avec `E2E_REALTIME=1` pour vérifier les mises à jour en direct.
- **Sans Docker** : `npm run stack:start` lance PostgreSQL (installé sur la machine), PostgREST et Supabase Auth (téléchargés depuis GitHub au premier lancement), avec une passerelle sur `http://127.0.0.1:54321`, et écrit `.env.local-stack`. Pas de Realtime : l'application bascule alors sur une actualisation toutes les 30 secondes, et l'indique.

```bash
npm run stack:start                       # terminal 1
set -a && source .env.local-stack && set +a
npx tsx scripts/local-stack/seed.ts       # données de démonstration (coach@tricoach.local, mot de passe Demo-tricoach-2026)
npm run dev                               # terminal 2, avec les mêmes variables
npm run test:e2e                          # terminal 3, avec les mêmes variables
```

`node scripts/local-stack/stack.mjs reset` efface les données locales.

Parcours Strava de bout en bout : les tests lancent un faux Strava sur le port 4010 (données fictives). Démarrez l'application avec, en plus des variables de `.env.local-stack` :

```bash
STRAVA_CLIENT_ID=4242 STRAVA_CLIENT_SECRET=fake-client-secret \
STRAVA_API_BASE_URL=http://127.0.0.1:4010/api/v3 STRAVA_OAUTH_BASE_URL=http://127.0.0.1:4010/oauth \
TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)" NEXT_PUBLIC_SITE_URL=http://localhost:3000 npm run dev
```

et lancez `npm run test:e2e` avec `STRAVA_CLIENT_ID=4242` et `SUPABASE_SECRET_KEY` (le coach de test devient administrateur). Sans ces variables, les parcours Strava sont ignorés.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) : fait, reste, décisions.
- [docs/SCHEMA.md](docs/SCHEMA.md) : tables, relations, sécurité.
- [docs/WORKOUT_FORMAT.md](docs/WORKOUT_FORMAT.md) : format des séances structurées et calculs.
- [docs/EXPORTS.md](docs/EXPORTS.md) : exports Zwift et Garmin, conditions des fournisseurs, règles de conversion.
- [docs/FITNESS.md](docs/FITNESS.md) : condition physique, fatigue et forme (méthode, sources, prévision).
- [docs/PARTNERS.md](docs/PARTNERS.md) : accès partenaires de Garmin et Suunto pour l'envoi automatique vers les montres (état, demande Suunto prête, pistes étudiées : application Suunto, application Android).
- [docs/GARMIN_WATCH.md](docs/GARMIN_WATCH.md) : application TriCoach pour montre Garmin (fonctionnement, compilation dans GitHub, installation).

Fonctions de la phase 5 : application installable (manifeste, icônes, page hors connexion, sans aucune donnée gardée sur l'appareil), page « Progression » (athlète et coach), notifications dans l'application (cloche, réglages par type), rubrique « Vos données » des réglages (téléchargement de toutes ses données en JSON, suppression définitive du compte). La tâche quotidienne (`/api/cron/daily`, Vercel Cron) envoie aussi les rappels de séance sans retour ; elle demande `CRON_SECRET` et `SUPABASE_SECRET_KEY`.
