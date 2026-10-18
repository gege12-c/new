# TriCoach

Plateforme de coaching triathlon : le coach programme sur le Web, l'athlète retrouve ses séances sur son téléphone.
Next.js 16 (TypeScript) + Supabase (PostgreSQL, Auth, RLS), déployé sur Vercel.

État d'avancement : [docs/STATUS.md](docs/STATUS.md). Cahier des charges : [CLAUDE.md](CLAUDE.md).

## Mise en ligne

La base Supabase de production (`supabase-rose-candle`, référence `ugqtfkuisaqjdnwxvogm`) est prête : les migrations sont appliquées et la sécurité vérifiée. Il reste deux réglages, à faire une fois.

### 1. Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com), créez un nouveau projet et importez le dépôt `gege12-c/new`.
2. Ajoutez les variables d'environnement (Production, Preview et Development) :

   | Variable | Valeur |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://ugqtfkuisaqjdnwxvogm.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la clé publishable du projet (`sb_publishable_…`), dans les clés d'API Supabase |

   Si vous reliez plutôt le projet à la base via l'intégration Supabase de Vercel, les variables qu'elle crée (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) sont reconnues aussi.

3. Lancez le déploiement et notez l'adresse obtenue (par exemple `https://tricoach.vercel.app`).

La clé secrète Supabase n'est jamais nécessaire : l'application n'utilise que la clé publishable, et la sécurité repose sur les règles d'accès de la base.

### 2. Régler l'authentification Supabase

Dans la configuration de l'authentification du projet Supabase :

- **Site URL** : l'adresse Vercel de l'étape 1.
- **Redirect URLs** : ajoutez `https://<votre-domaine>/auth/confirm` (et `http://localhost:3000/auth/confirm` pour le développement).
- **Confirmation d'email** : tant qu'aucun service d'envoi d'emails (SMTP) n'est configuré, Supabase n'envoie d'emails qu'aux membres de l'organisation du projet. Pour que votre coach et vos athlètes puissent créer leur compte, désactivez la confirmation d'email ; réactivez-la après avoir configuré un service d'envoi. Le mot de passe oublié reste limité aux membres de l'organisation d'ici là.

### 3. Vérifier le parcours coach → athlète

1. Créez un compte en cochant « J'entraîne des athlètes ».
2. Dans « Mes athlètes », créez un lien d'invitation (avec l'email de l'athlète, ou sans).
3. Ouvrez le lien dans une fenêtre de navigation privée, créez le compte athlète et acceptez l'invitation.
4. Côté coach, l'athlète apparaît : ouvrez sa fiche et ajoutez une FTP. Côté athlète, elle apparaît dans « Profil sportif ».

### Devenir administrateur (facultatif)

Dans l'éditeur SQL Supabase :

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'votre-adresse@exemple.fr';
```

Un administrateur voit les comptes, jamais les données sportives.

### Nouveau projet Supabase (développement, test)

Appliquez les fichiers de [`supabase/migrations`](supabase/migrations) dans l'ordre de leur nom, soit en les collant un par un dans l'éditeur SQL, soit avec la CLI :

```bash
npx supabase login
npx supabase init          # crée supabase/config.toml, garde les migrations existantes
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

Les tests de base démarrent un PostgreSQL temporaire (binaires trouvés automatiquement, ou `PG_BIN`) ; avec `TEST_DATABASE_URL`, ils utilisent ce serveur à la place.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) : fait, reste, décisions.
- [docs/SCHEMA.md](docs/SCHEMA.md) : tables, relations, sécurité.
- [docs/WORKOUT_FORMAT.md](docs/WORKOUT_FORMAT.md) : format des séances structurées et calculs.
