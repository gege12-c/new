# Avancement

Dernière mise à jour : 18 octobre 2026, fin de la phase 1.

## Phase 1 — Socle : terminée

Critère de fin vérifié par les tests automatisés : un coach invite un athlète qui accepte, et un coach non autorisé ne lit ni ne modifie rien (`tests/db/security.test.ts`, `tests/db/invitations.test.ts`).

Livré :

- Projet Next.js 16 + TypeScript + Tailwind, navigation latérale sur ordinateur et barre basse sur mobile.
- Migrations Supabase : profils, rôles (athlète, coach, administrateur), relations coach-athlète avec permissions, invitations à usage unique, seuils historisés, compétitions, modèles et séances planifiées, journal d'audit.
- Sécurité : RLS sur toutes les tables, privilèges colonne par colonne, aucune table accessible sans connexion, fonctions d'autorisation hors API.
- Authentification : inscription, confirmation d'email, connexion, mot de passe oublié, déconnexion ; session rafraîchie par `src/proxy.ts`.
- Écrans : espace athlète (prochaines séances, objectif, seuils, gestion du coach et de ses permissions), profil sportif (objectifs, seuils datés, compétitions), espace coach (athlètes suivis, invitations, fiche athlète), réglages, page d'invitation.
- Format de séance v1 : schéma Zod, déroulé des répétitions, durée et distance (exactes, estimées ou inconnues), zones, avertissements, résumé texte, profil graphique.
- Tests : 63 au vert (29 unitaires, 34 sur un vrai PostgreSQL 16 avec une couche de compatibilité Supabase). Intégration continue GitHub Actions : lint, types, tests, build.

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

## Limites connues

- L'application n'a pas encore tourné contre un vrai projet Supabase : l'environnement de développement ne peut pas joindre de service externe. La logique de base (migrations, RLS, invitations) est testée sur PostgreSQL 16 ; le parcours complet est à vérifier avec l'étape 5 du README après la mise en ligne.
- Tests de bout en bout dans un navigateur (Playwright) : à mettre en place une fois l'application déployée.
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

1. Créer le dépôt GitHub (vide) et me donner son nom : le code y sera poussé.
2. Suivre le README, étapes 1 à 5 : projet Supabase, migrations, réglages d'authentification, déploiement Vercel, vérification du parcours.
3. Me signaler tout écart constaté à l'étape 5 au début de la prochaine session.
