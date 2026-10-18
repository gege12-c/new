# Avancement

Dernière mise à jour : 18 octobre 2026, fin de la phase 1 et mise en ligne sur Vercel.

## Phase 1 — Socle : terminée

Critère de fin vérifié par les tests automatisés : un coach invite un athlète qui accepte, et un coach non autorisé ne lit ni ne modifie rien (`tests/db/security.test.ts`, `tests/db/invitations.test.ts`). Vérifié aussi en production le 18 octobre 2026 : un compte coach et un compte athlète créés sur le site, invitation nominative acceptée, relation active avec les permissions par défaut, journal d'audit complet, aucune erreur dans les journaux Supabase.

Livré :

- Projet Next.js 16 + TypeScript + Tailwind, navigation latérale sur ordinateur et barre basse sur mobile.
- Migrations Supabase : profils, rôles (athlète, coach, administrateur), relations coach-athlète avec permissions, invitations à usage unique, seuils historisés, compétitions, modèles et séances planifiées, journal d'audit.
- Sécurité : RLS sur toutes les tables, privilèges colonne par colonne, aucune table accessible sans connexion, fonctions d'autorisation hors API.
- Authentification : inscription, confirmation d'email, connexion, mot de passe oublié, déconnexion ; session rafraîchie par `src/proxy.ts`.
- Écrans : espace athlète (prochaines séances, objectif, seuils, gestion du coach et de ses permissions), profil sportif (objectifs, seuils datés, compétitions), espace coach (athlètes suivis, invitations, fiche athlète), réglages, page d'invitation.
- Format de séance v1 : schéma Zod, déroulé des répétitions, durée et distance (exactes, estimées ou inconnues), zones, avertissements, résumé texte, profil graphique.
- Tests : 70 au vert (36 unitaires, 34 sur un vrai PostgreSQL 16 avec une couche de compatibilité Supabase). Intégration continue GitHub Actions : lint, types, tests, build.

## Décisions

| Sujet | Décision | Raison |
| --- | --- | --- |
| Cache Components (Next.js 16) | conservé, lectures de session sous `<Suspense>` | ce sera le fonctionnement par défaut de la prochaine version majeure |
| Contenu des séances | JSONB validé par un schéma versionné, plutôt qu'une table de blocs | répétitions imbriquées, lecture en un bloc, aucun texte libre ; la base contrôle la forme générale |
| Séances | `planned_sessions` (séance datée) + `workout_templates` (bibliothèque), pas de troisième table | éviter la redondance du modèle initial |
| Comptes | chaque compte a un profil sportif ; « coach » est un mode activable | un coach peut aussi s'entraîner |
| Invitations | jeton de 244 bits, stocké sous forme d'empreinte, à usage unique ; adresse confirmée exigée si l'invitation est nominative | sécurité et simplicité |
| Séances du coach | l'athlète peut seulement les déplacer (trigger) | le contenu reste la prescription du coach |
| Audit | contenu des séances noté « modifié », pas recopié | l'enregistrement automatique gonflerait le journal |
| Emails d'invitation | lien à copier ou email prérempli ; pas d'envoi automatique | aucun service d'envoi configuré : rien n'est simulé |
| Polices | Geist auto-hébergée (paquet `geist`) | build sans accès réseau aux polices |
| Clés Supabase | nouvelle clé « publishable » | format actuel recommandé par Supabase |
| Région des fonctions Vercel | Francfort (`fra1`, `vercel.json`) au lieu de Washington (`iad1`, défaut) | la base est à Zurich : chaque requête évite un aller-retour transatlantique |
| Contrôle de production | `GET /api/health` : validité de l'URL et de la clé Supabase déployées, inscription ouverte, confirmation d'email | vérifier un déploiement sans lire ses secrets ; uniquement des informations déjà publiques |

## Mise en production

| Élément | État |
| --- | --- |
| Base Supabase `supabase-rose-candle` (`ugqtfkuisaqjdnwxvogm`, Zurich, PostgreSQL 17) | migrations appliquées le 18 octobre 2026 ; RLS active sur les 10 tables (23 politiques) ; aucun accès anonyme ; analyseur de sécurité sans erreur |
| Projet Vercel `new` (`prj_2niwVUTlhR44kHnGK2As5ujUa1l7`) | en ligne sur https://new-bay-one-76.vercel.app ; relié au dépôt (branche `main`), variables Supabase en Production et Preview. L'import initial n'avait créé aucun déploiement (« 404 DEPLOYMENT_NOT_FOUND ») : premier déploiement lancé par l'API le 18 octobre 2026 |
| Connexion Vercel → Supabase | vérifiée le 18 octobre : `/api/health` répond `"supabase": "ok"` depuis Francfort, et la page d'invitation interroge la base avec succès (journaux Supabase) |
| Réglages d'authentification Supabase | faits le 18 octobre : Site URL et Redirect URLs sur le domaine de production, confirmation d'email désactivée en attendant un SMTP (contrôlé par `/api/health` et les journaux d'authentification) |
| Parcours coach → athlète | vérifié en production le 18 octobre (voir phase 1) |

Accès du connecteur Vercel : lecture du projet, des variables (noms) et création de déploiements possibles ; journaux de build et d'exécution refusés (403 sur l'espace `geraldegea12-9585`).

Avertissements de l'analyseur Supabase acceptés : les fonctions `create_invitation`, `accept_invitation`, `get_invitation_preview`, `revoke_invitation`, `revoke_coach_link`, `set_coach_permissions` et `current_user_is_admin` sont volontairement appelables depuis l'API ; chacune vérifie elle-même l'identité de l'appelant.

## Limites connues

- Sans service d'envoi d'emails (SMTP), Supabase n'envoie d'emails qu'aux membres de l'organisation : confirmation d'email à désactiver d'ici là, mot de passe oublié limité à ces membres.
- Confirmation d'email désactivée, une invitation nominative ne prouve plus que l'adresse appartient à l'athlète : le lien à usage unique reste le secret. Configurer un SMTP et réactiver la confirmation rétablit ce contrôle.
- Tests de bout en bout dans un navigateur (Playwright) : à mettre en place.
- Avertissements `npm audit` sur des dépendances de développement (ESLint) uniquement, sans effet sur l'application en ligne.

## Phase 2 — Planification : prochaine session

À livrer :

1. Éditeur de séances structurées (toutes disciplines, répétitions imbriquées, aperçu, avertissements en direct, calcul des totaux).
2. Bibliothèque de modèles du coach.
3. Calendriers coach et athlète : vues jour, semaine, mois, agenda ; glisser-déposer ; filtres ; copie de semaine.
4. Brouillon et publication, autosave avec indicateur, contrôle de version (`version`) pour ne jamais écraser une modification.
5. Commentaires (privés coach, visibles athlète) et historique des modifications.
6. Temps réel : publication Supabase Realtime sur `planned_sessions`.

Critère de fin : une séance publiée apparaît chez l'athlète en quelques secondes, sans rechargement ni modification perdue.

## À faire de votre côté

Dépôt GitHub : `gege12-c/new`.

1. Rien de bloquant : la phase 1 tourne en production.
2. Phase 2 : ouvrir une nouvelle session sur le dépôt et demander la phase 2.
3. Plus tard (au plus tard en phase 5) : créer un compte chez un service d'envoi d'emails, saisir ses identifiants SMTP dans Supabase (Authentication, Emails, SMTP Settings), puis réactiver « Confirm email ». Cela rétablit la confirmation des adresses et le mot de passe oublié pour tous.
