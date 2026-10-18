# TriCoach

Plateforme de coaching triathlon : le coach programme sur le Web, l'athlète retrouve ses séances sur son téléphone.
Next.js 16 (TypeScript) + Supabase (PostgreSQL, Auth, RLS), déployé sur Vercel.

État d'avancement : [docs/STATUS.md](docs/STATUS.md). Cahier des charges : [CLAUDE.md](CLAUDE.md).

## Mise en ligne, pas à pas

Compter environ une heure la première fois. Rien n'est à installer pour les étapes 1 à 4 : tout se fait dans le navigateur.

### 1. Créer le projet Supabase

1. Créez un compte sur [supabase.com](https://supabase.com) puis un nouveau projet (offre gratuite), dans une région européenne.
2. Notez le mot de passe de la base dans votre gestionnaire de mots de passe.
3. Dans les paramètres du projet, rubrique des clés d'API, relevez :
   - l'**URL du projet** (`https://xxxx.supabase.co`) ;
   - la **clé publishable** (`sb_publishable_…`), destinée au navigateur.

   Ne copiez jamais la clé secrète (`sb_secret_…`) dans ce dépôt ni dans le chat.

### 2. Créer les tables et la sécurité

**Sans rien installer** : ouvrez l'éditeur SQL de Supabase, puis copiez-collez et exécutez **dans l'ordre** chaque fichier du dossier [`supabase/migrations`](supabase/migrations) :

1. `20261018120000_core_schema.sql`
2. `20261018120100_functions.sql`
3. `20261018120200_security.sql`

Chaque exécution doit se terminer sans erreur avant de passer à la suivante.

**Avec le terminal** (alternative, depuis un ordinateur avec Node.js 22) :

```bash
npx supabase login
npx supabase init          # crée supabase/config.toml, garde les migrations existantes
npx supabase link --project-ref <identifiant-du-projet>
npx supabase db push
```

### 3. Régler l'authentification Supabase

Dans la configuration de l'authentification (URL) :

- **Site URL** : l'adresse Vercel de l'étape 4 (par exemple `https://tricoach.vercel.app`). Revenez la renseigner après le premier déploiement.
- **Redirect URLs** : ajoutez `https://<votre-domaine>/auth/confirm` et, pour le développement, `http://localhost:3000/auth/confirm`.
- Laissez la **confirmation d'email activée** : l'invitation nominative d'un athlète exige une adresse confirmée.

L'envoi d'emails intégré à Supabase est limité en volume : suffisant pour vos essais, mais configurez un service d'envoi (SMTP) avant d'inviter davantage d'athlètes.

### 4. Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com), connectez-vous avec GitHub et importez ce dépôt.
2. Ajoutez les variables d'environnement (Production et Preview) :

   | Variable | Valeur |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clé publishable |
   | `NEXT_PUBLIC_SITE_URL` | adresse publique du site, sans `/` final (facultatif mais recommandé) |

3. Lancez le déploiement, puis reportez l'adresse obtenue dans la **Site URL** Supabase (étape 3).

### 5. Vérifier le parcours coach → athlète

1. Créez un compte en cochant « J'entraîne des athlètes », puis confirmez votre adresse.
2. Dans « Mes athlètes », créez un lien d'invitation (avec l'email de l'athlète, ou sans).
3. Ouvrez le lien dans une fenêtre de navigation privée, créez le compte athlète, confirmez l'adresse, acceptez l'invitation.
4. Côté coach, l'athlète apparaît : ouvrez sa fiche, ajoutez une FTP. Côté athlète, elle apparaît dans « Profil sportif ».

### Devenir administrateur (facultatif)

Dans l'éditeur SQL Supabase :

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'votre-adresse@exemple.fr';
```

Un administrateur voit les comptes, jamais les données sportives.

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

Les tests de base démarrent un PostgreSQL temporaire (binaires trouvés automatiquement, ou `PG_BIN`) ; avec `TEST_DATABASE_URL`, ils utilisent ce serveur à la place.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) : fait, reste, décisions.
- [docs/SCHEMA.md](docs/SCHEMA.md) : tables, relations, sécurité.
- [docs/WORKOUT_FORMAT.md](docs/WORKOUT_FORMAT.md) : format des séances structurées et calculs.
