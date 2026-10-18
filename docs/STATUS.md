# Avancement

Dernière mise à jour : 18 octobre 2026, fin de la phase 2 (planification) et refonte visuelle.

## Phase 2 — Planification : terminée en local, mise en production en attente

Critère de fin : une séance publiée apparaît chez l'athlète en quelques secondes, sans rechargement ni modification perdue.

Vérification :

- « Aucune modification perdue » : 53 tests sur un vrai PostgreSQL (`tests/db/planning.test.ts` : fusion champ par champ, conflits, modifications en attente, deux éditeurs ouverts, recalage, droits) et 8 parcours Playwright dans un navigateur (`e2e/`), dont deux éditions concurrentes, deux onglets sur une séance publiée, glisser-déposer, copie de semaine, commentaires et notes privées.
- « En quelques secondes, sans rechargement » : le parcours `e2e/planning.spec.ts` vérifie qu'une séance publiée par le coach s'affiche chez l'athlète en moins de 8 secondes sans recharger la page. Il tourne dans la CI (tâche `e2e`) contre la pile Supabase officielle, Realtime compris ; la pile locale sans Docker n'a pas de Realtime (la page s'y actualise toutes les 30 s, et l'indique).
- En production : à vérifier dès que la migration `planning` est appliquée (voir « À faire de votre côté »).

Livré :

- Éditeur de séances structurées : toutes disciplines et enchaînements, répétitions imbriquées, cibles en plage, consignes et matériel, aperçu graphique, avertissements en direct sans correction silencieuse, totaux calculés avec les seuils de l'athlète à la date de la séance.
- Enregistrement automatique (1,2 s après la dernière frappe) avec indicateur, enregistrement explicite (bouton et Ctrl/Cmd + S), alerte avant de quitter une page non enregistrée.
- Brouillon ou publié. Une séance publiée modifiée garde sa version publiée chez l'athlète : les modifications restent « en attente » jusqu'à « Publier les modifications » (ou « Abandonner »).
- Jamais d'écrasement silencieux : chaque enregistrement est fusionné champ par champ avec l'état en base ; un champ changé des deux côtés déclenche un conflit expliqué, avec le choix de la version à garder, sans perdre les autres modifications.
- Calendrier coach par athlète : vues mois (avec volume prévu par semaine et par discipline), semaine, jour et liste ; glisser-déposer pour déplacer (Alt pour copier) ; glisser un modèle sur un jour ; copie de semaine (telle quelle ou en brouillon) ; duplication ; suppression avec confirmation.
- Calendrier athlète (mobile d'abord) : couleur par discipline, statuts, filtres par discipline et statut, détail en panneau sans quitter le calendrier ; l'athlète peut déplacer les séances de son coach et créer les siennes.
- Accueil athlète : séance du jour, suivante, semaine en cours et volumes par discipline, prochaine compétition, seuils.
- Tableau de bord coach : semaine en cours de chaque athlète, brouillons à publier, prochaines séances, prochaine course, dernier échange.
- Bibliothèque de modèles : création, modification, archivage, planification pour un athlète, enregistrement d'une séance comme modèle.
- Commentaires de séance partagés, et notes privées du coach (visibles de lui seul) ; historique des modifications de chaque séance.
- Temps réel : chaque changement visible envoie un signal sur le canal privé de l'athlète ; les pages ouvertes se mettent à jour d'elles-mêmes (indicateur « En direct »), avec repli automatique toutes les 30 s et au retour sur l'onglet.
- Refonte visuelle : typographie Archivo à largeur variable, palette « nuit » et couleurs par discipline (natation bleu, vélo ambre, course corail, renforcement violet, enchaînement orange), profils de séance colorés par zone, mode sombre complet.

## Décisions

| Sujet | Décision | Raison |
| --- | --- | --- |
| Cache Components (Next.js 16) | conservé, lectures de session sous `<Suspense>` | ce sera le fonctionnement par défaut de la prochaine version majeure |
| Contenu des séances | JSONB validé par un schéma versionné, plutôt qu'une table de blocs | répétitions imbriquées, lecture en un bloc, aucun texte libre ; la base contrôle la forme générale |
| Séances | `planned_sessions` (séance datée) + `workout_templates` (bibliothèque) | éviter la redondance du modèle initial |
| Comptes | chaque compte a un profil sportif ; « coach » est un mode activable | un coach peut aussi s'entraîner |
| Invitations | jeton de 244 bits, stocké sous forme d'empreinte, à usage unique | sécurité et simplicité |
| Séances du coach | l'athlète peut seulement les déplacer (trigger) | le contenu reste la prescription du coach |
| Audit | contenu des séances noté « modifié », pas recopié ; les entrées d'une séance restée brouillon ne sont visibles que des coachs | l'enregistrement automatique gonflerait le journal ; un brouillon n'existe pas encore pour l'athlète |
| Concurrence | fusion à trois voies champ par champ (`save_planned_session`) au lieu d'un simple numéro de version | un déplacement fait par l'athlète pendant que le coach modifie le contenu n'est ni perdu ni bloquant ; seul un vrai conflit est signalé |
| Code d'erreur de conflit | `PT409` (HTTP 409) | avec le code standard `40001`, PostgREST relance la transaction en boucle |
| Modifications d'une séance publiée | table `planned_session_drafts`, fusionnée elle aussi ; base de publication fixée par la base de données | l'athlète ne voit jamais une version à moitié modifiée ; deux éditeurs ouverts ne s'écrasent pas |
| Annuler ou repasser en brouillon | refusé tant que des modifications sont en attente | aucune modification ne disparaît sans décision explicite |
| Temps réel | Realtime Broadcast depuis des triggers, canal privé `athlete:<id>` autorisé par RLS ; le message ne contient que des identifiants et la page relit les données sous les droits de l'utilisateur | aucune donnée de séance ne transite par le canal ; brouillons et notes privées n'émettent rien |
| Notes privées | visibles de leur seul auteur (un coach de l'athlète) | une note de travail n'est pas destinée aux autres coachs |
| Duplication | une copie d'une séance publiée est publiée ; une séance annulée revient en brouillon | copier, c'est reproduire ; la copie de semaine propose « en brouillon » |
| Tests de bout en bout | Playwright ; en local, pile Supabase sans Docker (`scripts/local-stack` : PostgreSQL, PostgREST, Auth) ; dans la CI, pile officielle `supabase start` (`supabase/config.toml`) avec Realtime | l'environnement de développement n'a pas Docker ; Realtime ne tourne qu'avec la pile officielle |
| Polices | Archivo variable auto-hébergée (paquet `@fontsource-variable/archivo`), à la place de Geist | caractère sportif, largeurs variables pour les titres et les chiffres ; build sans accès réseau |
| Clés Supabase | nouvelle clé « publishable » | format actuel recommandé par Supabase |
| Région des fonctions Vercel | Francfort (`fra1`) | la base est à Zurich |
| Contrôle de production | `GET /api/health` | vérifier un déploiement sans lire ses secrets |

## Mise en production

| Élément | État |
| --- | --- |
| Base Supabase `supabase-rose-candle` (`ugqtfkuisaqjdnwxvogm`, Zurich, PostgreSQL 17) | migrations de la phase 1 appliquées. Migration `planning` (phase 2) **non appliquée** : l'application par le connecteur a été annulée deux fois le 18 octobre, faute de confirmation |
| Projet Vercel `new` | en ligne sur https://new-bay-one-76.vercel.app avec la phase 1 ; la phase 2 attend la migration (la branche `phase-2-planning` n'est fusionnée dans `main` qu'après) |
| Réglages d'authentification Supabase | faits le 18 octobre (Site URL, Redirect URLs, confirmation d'email désactivée en attendant un SMTP) |
| Realtime en production | contrôlé le 18 octobre : `realtime.send` et `realtime.topic` présents, droit de créer la politique de canal vérifié ; les partitions de messages se créent à la première connexion d'un navigateur |

Accès du connecteur Vercel : lecture du projet, des variables (noms) et création de déploiements possibles ; journaux de build et d'exécution refusés (403 sur l'espace `geraldegea12-9585`).

## Limites connues

- Sans service d'envoi d'emails (SMTP), Supabase n'envoie d'emails qu'aux membres de l'organisation : confirmation d'email désactivée, mot de passe oublié limité à ces membres. Une invitation nominative ne prouve donc pas l'adresse de l'athlète : le lien à usage unique reste le secret.
- Les séances réalisées (Strava) n'existent pas encore : les statuts « terminée », « partielle » et « manquée » arrivent en phase 3 ; une séance passée sans activité est affichée « à rapprocher », jamais « manquée » par supposition.
- Les boutons d'export (Zwift, Garmin) arrivent en phase 4.
- Avertissements `npm audit` sur des dépendances de développement uniquement.

## Phase 3 — Strava : prochaine session

À livrer : vérification de l'accord API Strava en vigueur (révisé le 1er juin 2026) avant tout code, connexion OAuth, webhooks, import de l'historique, rapprochement séance-activité.

Critère de fin : une activité Strava arrive par webhook, sans doublon, rattachée ou proposée à la bonne séance.

## À faire de votre côté

Dépôt GitHub : `gege12-c/new`.

1. Autoriser la mise à jour de la base de production : répondez « oui » dans la conversation (ou confirmez la demande du connecteur Supabase quand elle s'affiche). Rien n'a encore été modifié. Ensuite, la branche `phase-2-planning` est fusionnée et Vercel met le site à jour tout seul.
2. Vérifier le temps réel en production, une fois le site à jour : ouvrez le calendrier de l'athlète sur votre téléphone (compte athlète) ; sur l'ordinateur, côté coach, créez une séance pour cet athlète et cliquez sur « Publier ». Elle doit apparaître sur le téléphone en quelques secondes, sans toucher à l'écran. L'indicateur en haut du calendrier doit afficher « En direct ».
3. Plus tard (au plus tard en phase 5) : configurer un service d'envoi d'emails (SMTP) dans Supabase, puis réactiver « Confirm email ».
4. Phase 3 : ouvrir une nouvelle session et demander la phase 3. Préparez votre compte Strava (vous créerez l'application Strava vous-même ; je vous dirai quand et quoi saisir).
