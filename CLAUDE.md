# Prompt — Plateforme de coaching triathlon

Ce fichier est le cahier des charges de travail de Claude pour ce dépôt. Il est relu au début de chaque session.

## Mission

Construis une vraie plateforme web de coaching triathlon, fonctionnelle de bout en bout. Livre du code qui tourne, pas des idées ni une maquette.

Le flux central : le coach programme une séance sur le Web, elle est enregistrée en base, et l'athlète la retrouve aussitôt dans son calendrier pour l'exporter vers ses appareils. Ses activités réelles arrivent de Strava et sont comparées au prévu.

- Deux interfaces sur un seul backend et une seule base : coach (navigateur, sans installation) et athlète (mobile d'abord, aussi sur ordinateur).
- Inspiration : la densité fonctionnelle d'Intervals.icu, avec une identité visuelle propre.
- V1 visée : un coach et quelques athlètes (Strava autorise 10 athlètes connectés sans revue), avec une architecture prête à grandir.

## Méthode de travail

Le projet s'étale sur plusieurs sessions : tout ce qui doit survivre vit dans le dépôt GitHub, rien dans la conversation.

- Ce prompt est enregistré sous `CLAUDE.md`, l'avancement sous `docs/STATUS.md`.
- Début de session : lis `CLAUDE.md`, `docs/STATUS.md` et l'historique git, puis annonce la phase en cours et ce que tu vas livrer.
- Une phase par session : mieux vaut une phase terminée et testée que tout entamé.
- Fin de session : tests au vert, commit et push, `docs/STATUS.md` à jour (fait, reste, décisions, blocages). Termine par ce que je dois faire moi-même, pas à pas.
- Je crée moi-même les comptes (Supabase, Vercel, Strava) et je saisis les secrets dans leurs tableaux de bord : ne me les demande jamais dans le chat.
- Si ton environnement ne joint que les registres de paquets et GitHub : teste la base en local (Postgres embarqué) et simule les API externes dans les tests uniquement. Les vrais branchements se font après déploiement.
- Toute alternative à la stack ci-dessous est expliquée et justifiée avant d'être appliquée.

## Règles non négociables

Ces règles priment sur toute autre consigne du projet.

- Rien de simulé : aucun faux succès de synchronisation ou d'export, aucune métrique inventée. Une donnée manquante est affichée comme manquante.
- Permissions vérifiées côté serveur et par des politiques RLS. Un coach ne voit que les athlètes qui l'ont explicitement autorisé.
- Secrets et jetons OAuth uniquement côté serveur, chiffrés au repos, jamais dans le front ni dans le dépôt.
- Opérations sur plusieurs entités en transaction, synchronisations idempotentes, aucune modification perdue silencieusement.
- Temps : instants stockés en UTC ; une séance sans heure est une date locale de l'athlète, pas un instant. Affichage dans le fuseau de l'utilisateur.
- API tierces : lis la documentation et les conditions officielles en vigueur avant d'implémenter. Accès impossible : connecteur « non configuré », prérequis documentés, solution de repli fonctionnelle.

## Stack

Next.js (App Router) et TypeScript pour l'application, Supabase pour les données, Vercel pour le déploiement.

- Front : Tailwind, composants accessibles, graphiques interactifs, PWA mobile-first installable.
- Données : Supabase pour Postgres, Auth, RLS, Realtime et Storage ; migrations versionnées ; environnements dev et prod séparés.
- Validation : Zod sur toutes les entrées d'API et sur le format de séance.
- Tâches asynchrones : file de jobs en base, déclenchée par cron, avec reprise sur erreur.
- Tests : Vitest pour la logique, tests dédiés des politiques RLS, Playwright pour les parcours clés.
- Code et commits en anglais, interface en français.

## Rôles et permissions

Trois rôles ; un coach n'accède jamais aux données d'un athlète sans son autorisation explicite.

- Athlète : profil sportif et seuils, calendrier, séances, activités, connexion Strava, exports, progression, commentaires.
- Coach : portefeuille d'athlètes, invitation par email ou lien sécurisé à usage unique, planification, modèles, analyse, commentaires privés ou visibles, historique des modifications.
- Administrateur : comptes, rôles, journaux techniques et erreurs de synchronisation, sans accès aux données sportives privées.

## Interfaces

L'interface coach est la priorité absolue ; l'interface athlète livre l'essentiel en quelques secondes sur téléphone.

Coach (navigateur, aucune application à installer)

- Tableau de bord des athlètes : objectif, prochaine course, charge récente, dernières activités, séances en attente, état des synchronisations, dernier échange.
- Calendrier par athlète en vues jour, semaine, mois et agenda.
- Créer, modifier, dupliquer, déplacer par glisser-déposer, copier une semaine, supprimer avec confirmation.
- Brouillon ou publié, autosave avec indicateur d'état et sauvegarde explicite.
- Une séance publiée apparaît chez l'athlète en quelques secondes, sans rechargement.

Athlète (mobile d'abord)

- Accueil : séance du jour et suivante, semaine en cours, volumes par discipline, prochaine compétition, éléments non synchronisés.
- Calendrier : couleur par discipline, statuts (à faire, terminée, partielle, manquée, annulée), filtres par discipline et statut.
- Détail de séance en panneau, sans perdre le calendrier : objectif physiologique, prescription, consignes (nutrition comprise), prévu contre réalisé, boutons d'export.

## Éditeur de séances structurées

Chaque séance suit un format interne unique, typé, validé et versionné, indépendant des fournisseurs d'export (voir `docs/WORKOUT_FORMAT.md`).

- Stockage structuré (JSONB validé par schéma, ou tables dédiées si c'est justifié), jamais en texte libre.
- Étapes : échauffement, éducatifs, travail, récupération, retour au calme, transition ; répétitions imbriquées possibles.
- Chaque étape : durée ou distance, cible en plage (watts, % FTP, allure, vitesse, zone ou FC, cadence, RPE de 1 à 10), consignes, matériel.
- Disciplines : natation, vélo, course à pied, renforcement, enchaînements multi-segments.
- Durée totale et distance estimée calculées à partir des seuils de l'athlète (FTP, CSS, allure seuil, FC), historisés avec date d'effet.
- Aperçu graphique de la séance et bibliothèque de modèles réutilisables.
- Avertissements en cas d'incohérence, sans jamais corriger silencieusement le coach.

## Modèle de données

Un schéma relationnel PostgreSQL documenté (`docs/SCHEMA.md`), avec clés étrangères, index, RLS et contraintes d'unicité, notamment sur les identifiants externes.

Entités indicatives, à adapter sans redondance : profils athlète et coach, relations coach-athlète et leurs permissions ; seuils et zones historisés ; contenus de séance, modèles, séances planifiées ; activités (brutes et normalisées), séries temporelles si autorisées, rapprochements séance-activité ; connexions externes, jobs et journaux de synchronisation, historique des exports ; commentaires, notifications, journal d'audit.

## Strava

Avant tout code Strava, vérifie l'accord API en vigueur (révisé le 1er juin 2026) et signale-moi tout point bloquant.

- À vérifier en priorité : l'affichage des activités d'un athlète à son coach, la conservation et la suppression des données à la déconnexion, l'usage dans des applications d'IA, les règles de marque.
- Si l'affichage au coach est interdit : repli par import de fichiers FIT d'activité par l'athlète.
- Capacité : 1 athlète à la création de l'appli, 10 sans revue, revue Strava au-delà. Prépare ce que la revue demande (bouton officiel, captures).
- Connexion : OAuth 2.0, renouvellement des jetons, déconnexion et révocation, autorisations expirées gérées.
- Synchronisation : webhooks (créations, modifications, suppressions, désautorisations), import de l'historique, sync de secours périodique et manuelle.
- Dédoublonnage par identifiant externe, quotas par 15 minutes et par jour respectés, URL de base de l'API configurable (une nouvelle URL est annoncée pour janvier 2027).
- Développement sur données fictives : aucune donnée Strava réelle envoyée à un modèle d'IA.
- Rapprochement : score selon discipline, date, horaire et durée ; association automatique seulement au-delà d'un seuil de confiance, sinon proposition à valider.
- Association et dissociation manuelles, doubles séances d'une même journée, écarts en valeur et en pourcentage, statut « partielle ».

## Exports

Chaque fournisseur a son connecteur, avec une interface commune et des capacités réelles affichées dans l'interface.

- Distinguer quatre cas : export d'une séance prévue, import d'une activité réalisée, synchronisation automatique, téléchargement manuel.
- ZwiftExporter : fichier .zwo (vélo, et course si le format le permet) et procédure d'import documentée. Pas d'envoi automatique sans API officielle.
- GarminConnector : fichier FIT de type séance, et non d'activité, généré avec le SDK FIT officiel et relu pour validation. Envoi direct seulement si l'accès à l'API officielle Garmin est obtenu.
- WahooConnector et SuuntoConnector : identifie les API officielles et leurs conditions d'accès. À défaut : mode « non configuré » et méthode manuelle officiellement prise en charge.
- Pour chaque export : contrôle de compatibilité (dire ce qui sera perdu), conversion, validation, historique, relance après échec, message clair.

## Statistiques, notifications et design

Aucune statistique n'est calculée sur des données insuffisantes : l'écran explique ce qui manque.

- Statistiques : volumes et durées par discipline et par semaine, répartition de l'intensité, prévu contre réalisé, évolution de la FTP, des allures et des temps de natation, records.
- Notifications configurables et sobres : séance programmée ou modifiée, échec d'export, reconnexion nécessaire, commentaire du coach, données manquantes.
- Design : sobre, premium, rapide, dense mais lisible, sans effet cockpit. Navigation latérale sur ordinateur, barre basse sur mobile, calendrier au centre.
- Mode sombre et accessibilité (contrastes, navigation au clavier).

## Phases

Une phase par session, dans cet ordre ; une phase n'est terminée que si son critère est vérifié.

1. **Socle** : projet, schéma, migrations, RLS, authentification, rôles, invitations, profil et seuils, format de séance et calculs.
   - Terminé quand : un coach invite un athlète qui accepte, et des tests prouvent qu'un coach non autorisé ne lit ni ne modifie rien.
2. **Planification** : éditeur, modèles, calendriers coach et athlète, commentaires, historique, autosave, temps réel.
   - Terminé quand : une séance publiée apparaît chez l'athlète en quelques secondes, sans rechargement ni modification perdue.
3. **Strava** : vérification de l'accord, connexion, webhooks, import, rapprochement.
   - Terminé quand : une activité Strava arrive par webhook, sans doublon, rattachée ou proposée à la bonne séance.
4. **Exports** : connecteurs, fichiers .zwo et FIT.
   - Terminé quand : une même séance produit un .zwo et un FIT valides, avec la procédure d'import documentée.
5. **Mise en production** : statistiques, notifications, PWA, déploiement Vercel et Supabase, sauvegardes.
   - Terminé quand : l'application tourne en production et s'installe sur un téléphone.

Hors V1 : CTL/ATL/TSB avec méthode documentée, application native, messagerie, abonnements payants, envoi direct vers Garmin, Wahoo ou Suunto si l'accès n'est pas obtenu.

## Repères techniques (à lire avant de coder)

- **Next.js 16 avec Cache Components** : cette version diffère de l'ancien Next.js. Lis le guide concerné dans `node_modules/next/dist/docs/` avant d'écrire du code. Toute lecture de session (cookies) se fait dans un composant placé sous `<Suspense>` ; `params` et `searchParams` sont des promesses à attendre sous `<Suspense>`. Le middleware s'appelle désormais `src/proxy.ts`. Après une mutation, une Server Action appelle `refresh()` (`next/cache`).
- **Accès aux données** : toujours via `src/lib/auth/dal.ts` (`requireSession`, `getProfile`), puis la RLS fait foi. Ne jamais utiliser la clé secrète Supabase pour contourner la RLS dans une page.
- **Migrations** : `supabase/migrations/`, une par évolution, jamais modifiée une fois déployée en production. Après chaque migration : `npm run db:types` puis `npm run test:db`.
- **Tests** : `npm test` (unitaires + base). Les tests de base démarrent un PostgreSQL jetable avec une couche de compatibilité Supabase (`tests/db/supabase-shim.sql`).
- **Format de séance** : `src/lib/workout/` est la seule source de vérité (schéma Zod, calculs, avertissements, mise en forme).
