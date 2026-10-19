# Avancement

Dernière mise à jour : 19 octobre 2026 (nuit), phases 4 et 5 livrées (exports, application installable, progression, notifications, vos données).

## Phase 5 — Mise en production : livrée, à confirmer sur votre téléphone

Critère de fin : l'application tourne en production et s'installe sur un téléphone. Elle tourne en production (déploiement automatique de `main`) ; l'installation est vérifiée par Chromium lui-même (aucune erreur d'installabilité, manifeste valide) dans la CI ; reste à l'essayer sur votre téléphone (voir « À faire »).

Vérification :

- `e2e/pwa.spec.ts` : manifeste et icônes servis, Chromium considère l'application comme installable (contrôle DevTools), page claire hors connexion puis retour en ligne, explications d'installation iPhone et Android dans les réglages.
- `e2e/stats.spec.ts` : l'athlète voit sa progression (réalisé d'après un fichier FIT, séance « faite » d'après son retour, record de puissance, tableau) ; le coach voit l'onglet « Progression » de son athlète.
- `e2e/notifications.spec.ts` : le coach publie une séance, l'athlète la voit dans la cloche, ouvre la séance depuis la notification, la notification passe en lue ; un commentaire de l'athlète prévient le coach ; un type coupé dans les réglages ne prévient plus.
- `e2e/admin.spec.ts` : l'administrateur voit les comptes et leurs rôles, sans donnée sportive ; 3 tests de base (`tests/db/admin.test.ts`) : liste, accès refusé aux autres, rôle donné et retiré, jamais au dernier administrateur.
- `e2e/a11y.spec.ts` : audit axe-core (WCAG 2.1, niveaux A et AA) des pages clés du coach sur ordinateur et de l'athlète sur téléphone, en clair et en sombre, calendrier rempli, panneau de séance et éditeur compris, ainsi que les pages publiques : aucune anomalie.
- `e2e/account.spec.ts` : un compte neuf télécharge ses données (fichier JSON relu, refusé sans connexion), puis supprime son compte en tapant SUPPRIMER ; il est déconnecté et ne peut plus se connecter. 4 tests de base (`tests/db/account-deletion.test.ts`) : un coach part (séances publiées conservées chez l'athlète sans auteur et toujours modifiables par l'autre coach, brouillons et modifications en attente effacés, historique anonymisé, aucune notification déclenchée) ; une athlète part (plus aucune ligne à son nom, nulle part, ni son identifiant dans l'historique) ; connexion Strava et jetons effacés ; fonction sans paramètre, donc impossible de viser un autre compte.
- 8 tests de base (`tests/db/notifications.test.ts`) : destinataires, regroupements, auteur jamais prévenu, notes privées muettes, droits (lecture et marquage des seules notifications reçues, aucune écriture directe), réglages, reconnexion Strava, export échoué, rappel quotidien unique ; 10 tests unitaires (statistiques, manifeste et icônes).

Livré :

- **Application installable** (PWA) : manifeste, icônes (dont masquables), écran d'accueil iPhone, page hors connexion. Le service worker ne garde aucune donnée sur l'appareil : seules les pages hors connexion sont servies sans réseau. Carte « TriCoach sur votre écran d'accueil » sur l'accueil athlète (téléphone) et rubrique « Application sur téléphone » dans les réglages.
- **Progression** (athlète, et onglet de la fiche athlète côté coach) : volume prévu par semaine et par discipline sur 12 semaines (enchaînements découpés par discipline) et réalisé d'après les fichiers FIT ; intensité prévue par zone sur 4 semaines ; suivi des séances passées (retours de l'athlète, fichiers FIT) ; évolution des seuils (FTP, allure seuil, CSS, FC seuil) ; records tirés des fichiers FIT. Chaque bloc dit ce qui manque au lieu de calculer sur trop peu de données ; tableau des valeurs ; couleurs de graphique contrôlées (contraste, daltonisme) en clair et en sombre.
- **Notifications** dans l'application : cloche avec le nombre de non lues, page des notifications, ouverture directe de la séance, « Tout marquer comme lu », réglage par type dans les réglages. Séance publiée, modifiée, déplacée ou annulée ; commentaire partagé ; reconnexion Strava nécessaire ; export impossible chez un athlète (pour ses coachs) ; rappel le lendemain d'une séance sans retour.
- **Administration, comptes et rôles** : liste des comptes (nom, email, mode coach, administrateur, relations, inscription, dernière connexion) et rôle d'administrateur donné ou retiré depuis la page Administration, sans aucune donnée sportive ; jamais le dernier administrateur.
- **Vos données** (réglages) : téléchargement de toutes ses données dans un fichier JSON (lues sous les droits de l'utilisateur ; les activités Strava restent chez Strava) ; suppression définitive du compte après avoir tapé SUPPRIMER : l'accès Strava est d'abord révoqué, puis tout est effacé en une transaction. Pour un coach, les séances déjà publiées restent chez ses athlètes ; ses brouillons, modèles, invitations et relations disparaissent.
- **Accessibilité contrôlée à chaque modification** : contrastes corrigés (texte secondaire, pastilles d'état, jours hors du mois, « Repos »), état des filtres du calendrier annoncé aux lecteurs d'écran. Au passage, l'éditeur ne plante plus sur une séance écrite hors de l'éditeur (par l'API) : le contenu est complété par le schéma, sans fausse modification.
- **En-têtes de sécurité** sur toutes les pages : pas d'affichage dans un cadre d'un autre site, types de fichiers stricts, adresse d'origine limitée, caméra, micro, position et paiement désactivés.
- **Sauvegardes** : procédure d'export documentée (README, « Sauvegardes ») ; l'offre gratuite de Supabase n'en fait pas automatiquement.

Pas fait (hors de portée cette nuit ou dépendant de vous) : notifications par email (il faut un service SMTP) et notifications push sur téléphone (clés VAPID à créer et à saisir dans Vercel) ; statistiques sur les activités Strava (interdites par Strava sans accord écrit).

## Phase 4 — Exports : terminée

Critère de fin : une même séance produit un .zwo et un FIT valides, avec la procédure d'import documentée.

Vérification :

- Parcours Playwright `e2e/exports.spec.ts`, dans un navigateur : sur un enchaînement vélo + course, l'athlète voit le contrôle de compatibilité avant de télécharger (course impossible sur Zwift sans allure seuil, marche à suivre affichée, bouton désactivé) ; il télécharge le .zwo du vélo (fichier relu : intervalles au bon pourcentage de FTP) et le FIT de la course (décodé avec le SDK FIT officiel : type séance, allure convertie en vitesse) ; l'historique compte deux exports ; le coach les voit, avec l'auteur. L'API refuse un visiteur non connecté (401), une demande invalide (400), une séance inaccessible (404), et renvoie la raison d'un export impossible (422).
- 21 tests unitaires (`src/lib/export/export.test.ts`) : la même séance donne un .zwo et un FIT valides et de même durée totale (69 min), rampes, intervalles, zones, watts sans FTP, course en durée et en distance, blocages expliqués, natation (distances, CSS en vitesse, matériel, départs), FC, répétitions imbriquées, textes trop longs, fichier abîmé détecté, enchaînement en deux fichiers, fiche texte.
- 7 tests de base (`tests/db/exports.test.ts`) : historique sous RLS (l'athlète et ses coachs ; un coach non autorisé ne lit ni n'ajoute rien ; brouillon invisible de l'athlète ; ni modification ni suppression ; incohérences refusées ; effacé avec la séance) ; 3 tests du fichier de mise à jour de la production (à jour, appliqué en une fois, tout ou rien).
- Contrôle croisé : les FIT produits relus aussi par un décodeur indépendant (`fitdecode`), CRC vérifié, valeurs identiques.
- CI : contrôles et parcours de bout en bout au vert (voir « Mise en production »).

Livré :

- Rubrique « Exporter vers mes appareils » dans chaque fiche de séance (athlète et coach) : pour Zwift et Garmin, contrôle de compatibilité affiché avant le téléchargement (« Compatible, sans perte », « 2 approximations » avec le détail étape par étape, ou « Export impossible » avec la marche à suivre), un fichier par discipline pour un enchaînement, téléchargement relu avant d'être servi, message clair et « Réessayer » après un échec, procédure d'import officielle pas à pas ; historique des exports, avec l'alerte « séance modifiée depuis ce téléchargement ».
- ZwiftExporter : fichier .zwo vélo et course (rampes, intervalles, sortie libre, allures de course rapportées à l'allure 10 km du profil Zwift), limites de Zwift contrôlées (250 blocs, 64 Ko).
- GarminConnector : fichier FIT de type séance écrit avec le SDK FIT officiel de Garmin et relu avec lui (cibles de puissance, FC, allure, cadence, cible secondaire, répétitions, matériel de natation, notes).
- Wahoo et Suunto : « envoi direct non configuré », avec les conditions officielles d'accès à leurs API et la méthode manuelle ; fiche texte de la séance à copier (valeurs absolues calculées avec les seuils de l'athlète).
- Panneau « Appareils et applications » du profil sportif : pour chaque fournisseur, les quatre cas (séance prévue vers l'appareil, téléchargement manuel, synchronisation automatique, activité réalisée vers TriCoach) avec leur état réel et les sources officielles.
- Détail des règles de conversion et des conditions des fournisseurs : [EXPORTS.md](EXPORTS.md).
- Un seul fichier SQL pour mettre la production à jour (phases 3 à 5) : `supabase/production/pending.sql`, généré à partir des migrations ; la CI vérifie qu'il est à jour et qu'il s'applique en une fois sur la pile Supabase officielle remise au niveau de la production.

## Phase 3 — Strava : terminée, mise en production à finaliser

Critère de fin : une activité Strava arrive par webhook, sans doublon, rattachée ou proposée à la bonne séance.

Vérification (données fictives uniquement, faux Strava : aucun accès à l'API réelle depuis cet environnement) :

- Parcours Playwright `e2e/strava.spec.ts`, dans un navigateur : l'administrateur active la réception des activités ; l'athlète connecte Strava (OAuth complet) ; une activité arrive par webhook, envoyée deux fois : une seule activité en base, rattachée automatiquement à la séance du soir et non à celle du matin, « Réalisé 58 min (97 %) » dans le calendrier, comparaison dans le panneau ; le coach ne la voit pas, l'athlète donne son retour (« Faite, RPE 6 ») et le coach le voit. Un fichier FIT importé par l'athlète est visible du coach.
- 12 tests d'intégration contre une vraie pile Supabase (`tests/integration/`) : connexion et jetons chiffrés, import des 7 derniers jours, webhook dédoublonné, modification relue, évènements d'un autre abonnement ignorés, suppression appliquée seulement après vérification chez Strava, jeton expiré renouvelé, quota presque atteint (report sans échec), retrait d'accès et déconnexion (révocation, effacement), autorisation incomplète refusée ; lectures du réalisé à travers l'API et la RLS (le coach ne voit jamais l'activité Strava).
- 20 tests de base (`tests/db/activities.test.ts`) : note de correspondance, rattachement ou proposition, deux séances le même jour, ambiguïté levée par une seconde activité, enchaînements, brouillons et séances annulées ignorés, séance déplacée, décisions préservées, droits, visibilité et expiration Strava, limite de 7 jours, identifiants uniques, file de jobs, canaux temps réel, comptage administrateur. Plus 24 tests unitaires (chiffrement, lecture FIT et archives, API Strava et quotas, prévu contre réalisé).
- CI : voir ci-dessous « Mise en production ».

Livré :

- Connexion Strava (OAuth 2.0, jeton anti-falsification, autorisation `read,activity:read_all` vérifiée), renouvellement des jetons, déconnexion avec révocation chez Strava, reconnexion demandée si Strava refuse l'accès.
- Réception par webhook (créations, modifications, suppressions, retrait d'accès) : réponse immédiate, traitement juste après ; synchronisation quotidienne de secours et bouton « Synchroniser maintenant » ; dédoublonnage par identifiant Strava ; quotas par 15 minutes et par jour lus dans les en-têtes et respectés ; adresse de l'API configurable (`STRAVA_API_BASE_URL`, nouvelle adresse annoncée pour janvier 2027).
- Import de fichiers FIT d'activité (y compris .zip de Garmin Connect et .fit.gz) depuis le profil, multisport découpé par discipline, sans doublon.
- Rapprochement automatique séance-activité, propositions à valider (« C'est bien cette séance » / « Ce n'est pas elle »), rattachement et détachement manuels, doubles séances d'une même journée, enchaînements.
- Prévu contre réalisé dans le panneau de séance : part du prévu, durée et distance avec écarts en valeur et en pourcentage, mesures de l'activité (allure ou vitesse, FC, puissance), lien « View on Strava », date d'effacement des données Strava.
- Statuts terminée, partielle, manquée et à rapprocher dans les calendriers (marque sur chaque séance, filtres), activités sans séance affichées et rattachables depuis le calendrier.
- Retour de l'athlète sur chaque séance passée : faite, en partie, pas faite, effort ressenti (RPE 1 à 10), note ; visible du coach.
- Accueil athlète : « À traiter » (reconnexion Strava, activités à valider, activités sans séance, séances sans retour). Tableau de bord coach : état de la connexion Strava, bilan des 7 derniers jours, dernier retour.
- Page Administration : configuration, abonnement webhook, file, quotas, journal technique.

## Accord API Strava (version du 1er juin 2026, relue les 18 et 19 octobre 2026)

| Point | Règle | Ce que fait TriCoach |
| --- | --- | --- |
| Affichage au coach | données Strava d'un utilisateur montrées à lui seul (§2.3, §6.2) | activités Strava visibles de l'athlète seul ; le coach a les fichiers FIT et les retours de séance |
| Conservation | 7 jours au plus en cache (§6.2) ; suppressions répercutées sous 48 h (§6.3) ; effacement après retrait d'accès (§7.4) | effacement à 6 jours ; suppression vérifiée et appliquée dès l'évènement ; tout effacé aussitôt à la déconnexion |
| IA | aucune utilisation des données Strava par un modèle d'IA, contexte compris (§5.3) | développement et tests sur données fictives ; je n'utilise jamais le connecteur Strava de cet environnement |
| Analyses | pas d'analyse ni d'agrégation de données Strava, même dérivées (§5.4) | comparaison séance par séance pour l'athlète seulement ; aucun volume ni statistique agrégée sur Strava |
| Consentement | personne d'autre que l'athlète ne voit ses données sans accord exprès (§5.13) | rien n'est partagé, même avec accord (prudence) |
| Marque | pas de « Strava » dans le nom de l'application ; liens « View on Strava » ; bouton officiel « Connect with Strava » | liens « View on Strava » en place ; bouton et logo officiels à intégrer (fichiers à fournir, voir plus bas) |
| Accès | abonnement Strava exigé depuis juin 2026 ; capacité de 1 athlète, 10 sans revue, revue au-delà | à régler sur la page de l'application Strava |

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
| Strava et coach | les activités Strava ne sont montrées qu'à l'athlète ; le coach voit les fichiers FIT importés (s'il y est autorisé) et le retour de séance de l'athlète (faite, partielle, pas faite, RPE, note) | politique API Strava du 1er juin 2026 (§2.3, §6.1, §6.2) ; choix validé le 18 octobre (« Strava + FIT + déclaration ») |
| Conservation des données Strava | effacement 6 jours après la première lecture, jamais repoussé ; suppression répercutée dès l'évènement (vérifiée auprès de Strava) et à chaque synchronisation ; tout est effacé à la déconnexion ou au retrait d'accès ; aucun nom ni profil Strava conservé | §6.2 (7 jours au plus), §6.3 (48 h), §7.4 ; marge d'un jour pour la tâche quotidienne |
| Historique Strava | import des 7 derniers jours à la connexion, pas au-delà | des données plus anciennes devraient être effacées aussitôt (§6.2) |
| Statistiques sur Strava | aucune statistique agrégée (volumes réalisés, tendances) calculée sur des données Strava ; seule la comparaison séance par séance est montrée à l'athlète | §5.4 interdit les analyses et agrégations de données Strava, y compris dérivées ; la phase 5 s'appuiera sur les fichiers FIT et les retours, sauf accord écrit de Strava |
| Jetons OAuth | chiffrés par l'application (AES-256-GCM, données associées = connexion), clé `TOKEN_ENCRYPTION_KEY` hors de la base ; table sans aucun privilège pour l'API ; renouvellement protégé par un numéro de révision | une fuite de la base seule ne livre aucun jeton utilisable |
| File de jobs | table `sync_jobs` (dédoublonnage par clé, reprise exponentielle, quotas respectés sans compter d'échec) ; traitement juste après la réponse au webhook (`after()`), synchronisation quotidienne par Vercel Cron (3 h 20 UTC) et manuelle | Strava attend une réponse sous 2 s ; l'offre Hobby de Vercel limite les tâches planifiées à une par jour |
| Rapprochement | en SQL, par triggers, sous un verrou par athlète ; note discipline/date/heure/volume ; automatique à partir de 0,68 et sans ambiguïté, proposé à partir de 0,45 ; décisions de l'utilisateur jamais remises en cause | même règle pour Strava et FIT, recalcul à chaque changement de séance ou d'activité, sans job supplémentaire |
| Statut d'une séance | retour de l'athlète, sinon activité rattachée (terminée à 80 % du prévu, partielle en deçà), sinon « à rapprocher » ; jamais « manquée » par supposition | rien de simulé ; le coach voit un statut fondé sur ce qu'il a le droit de voir |
| Import FIT | lu dans le navigateur avec le SDK FIT officiel de Garmin ; seul le résumé part au serveur (pas de trace GPS) ; .zip de Garmin Connect et .fit.gz décompressés sans dépendance ; identifiant = empreinte SHA-256 du fichier et numéro de segment | dédoublonnage naturel, limite de 1 Mo des Server Actions évitée |
| Temps réel des activités | canal `self:<id>` réservé à l'athlète pour tout ce qui touche Strava ; `athlete:<id>` pour les retours et les fichiers FIT | aucun signal lié à Strava n'atteint le coach |
| Mise en ligne avant la migration | le code détecte une table ou une fonction absente (codes `PGRST205`, `PGRST202`, `42P01`…) et affiche « disponible après la mise à jour de la base » | le déploiement ne dépend plus de l'ordre code/base ; rien n'est simulé |
| `pg_safeupdate` | aucune instruction DELETE ou UPDATE sans WHERE dans les migrations, contrôlé par un test statique (`tests/db/migrations-lint.test.ts`) | Supabase refuse ces instructions pour l'API, même dans une fonction ou un trigger ; la CI l'a révélé (la création de séances aurait échoué en production), les bases de test locales n'ont pas cette extension |
| Exports : un fichier par discipline | un enchaînement donne un .zwo et un FIT par segment | un fichier de séance FIT ne porte qu'un sport ; Zwift ne connaît pas l'enchaînement |
| Exports : aucune correction silencieuse | chaque écart est classé (bloquant, perte, information) et affiché avant le téléchargement ; un fichier qui échoue à la relecture n'est jamais servi | « rien de simulé », et le coach sait exactement ce que l'athlète recevra |
| Zwift et la course | intensité en fraction de l'allure 10 km du profil Zwift (`pace="2"`), assimilée à l'allure seuil ; étape facile sans allure à 80 %, étape de travail sans allure bloquée | Zwift exige une intensité en course ; l'hypothèse d'allure facile est celle des calculs de durée |
| Zone 1 vers une valeur unique (Zwift) | haut de la plage (80 à 100 % de la borne haute) au lieu du centre | « moins de 55 % FTP » ne veut pas dire 27 % |
| FIT : cibles relatives | % FTP gardé relatif (l'appareil applique sa FTP) ; zones de puissance et de FC converties en plages (% FTP, bpm) avec le modèle de TriCoach | les zones réglées sur la montre peuvent différer de celles du coach |
| FIT : répétitions imbriquées | la répétition extérieure reste une répétition, l'intérieure est déroulée | prise en charge inégale des répétitions imbriquées selon les appareils |
| Seuils des exports | ceux en vigueur à la date de la séance | même règle que les durées estimées |
| Historique des exports | chaque tentative, réussie ou non, sous les droits de l'utilisateur ; un échec d'écriture de l'historique ne bloque pas un fichier valide (signalé) | traçabilité sans priver l'athlète de sa séance |
| Contenu des séances à la lecture | normalisé par le schéma (valeurs par défaut) avant affichage et export | une séance écrite hors de l'éditeur (API) ne fait plus échouer le panneau |
| Mise à jour de la production | un fichier SQL unique (`supabase/production/pending.sql`), une seule transaction, inscrit aussi les migrations dans l'historique Supabase | une seule manipulation, tout ou rien ; le connecteur Supabase ne peut pas appliquer de migration sans confirmation affichée |
| Application installable | manifeste + service worker limité à une page hors connexion, sans cache de données | installable (Chrome exige un service worker pour proposer l'installation) sans jamais montrer une séance périmée ni garder de données d'athlète sur l'appareil |
| Statistiques et Strava | volumes réalisés, suivi et records calculés sur les seuls fichiers FIT et retours de séance ; une séance confirmée seulement par Strava compte « sans retour » | accord API Strava §5.4 (aucune agrégation, même dérivée) |
| Seuils des statistiques | ceux en vigueur à la date de chaque séance | même règle que les durées estimées et les exports |
| Notifications | écrites par la base (triggers), dans l'application seulement, regroupées, réglables par type ; aucune donnée Strava | rien ne peut être oublié par un chemin de l'application ; sobres par construction ; email et push demandent des comptes et des secrets que vous créez |
| Rappel « séance sans retour » | une fois par séance, le lendemain (date locale de l'athlète), par la tâche quotidienne | pas de harcèlement ; fonctionne même sans Strava |
| Suppression du compte | fonction `delete_my_account()` sans paramètre, une seule transaction ; l'application révoque Strava juste avant ; séances publiées d'un coach conservées chez l'athlète, sans auteur ; brouillons et modifications en attente du coach effacés ; journal d'audit effacé pour ce compte, anonymisé ailleurs | droit à l'effacement (RGPD) et accord Strava (§7.4) ; une séance publiée appartient à l'athlète ; aucune clé secrète nécessaire, impossible de viser un autre compte |
| Export des données personnelles | fichier JSON lu sous les droits de l'utilisateur (RLS), sans les activités Strava ni leurs rapprochements | droit d'accès et de portabilité ; TriCoach ne garde les données Strava que quelques jours, l'athlète les télécharge chez Strava |
| Accessibilité | audit axe-core WCAG 2.1 AA dans les tests de bout en bout, en clair et en sombre ; texte secondaire `#58687c` et vert de réussite `#117a46` (thème clair) | contraste d'au moins 4,5:1 partout, y compris sur les fonds teintés ; la navigation au clavier se vérifie encore à la main |
| Administration | page `/admin` : configuration (présente ou non, jamais les valeurs), abonnement webhook, file, quotas, journal ; génération des valeurs secrètes dans le navigateur | vous saisissez les secrets vous-même, sans les écrire dans une conversation |

## Phases 1 et 2 : terminées

- Phase 1 (socle) : schéma, RLS, authentification, rôles, invitations à usage unique, profil et seuils historisés, format de séance et calculs.
- Phase 2 (planification) : éditeur de séances structurées, modèles, calendriers coach et athlète, commentaires et notes privées, historique, enregistrement automatique sans écrasement silencieux (fusion champ par champ), temps réel vérifié en CI. Détail dans l'historique git (`docs: record phase 2 delivery…`).

## Mise en production

| Élément | État |
| --- | --- |
| Base Supabase `supabase-rose-candle` (`ugqtfkuisaqjdnwxvogm`, Zurich, PostgreSQL 17) | phases 1 et 2 à jour. **Migrations des phases 3, 4 et 5 en attente**, réunies dans un seul fichier à coller dans l'éditeur SQL : `supabase/production/pending.sql` (voir « À faire de votre côté »). Le connecteur Supabase ne peut pas les appliquer sans une confirmation qui ne s'affiche pas ici. Elles ajoutent des tables, fonctions et triggers et remplacent une fonction existante (`guard_planned_session`, qui n'inscrit plus comme dernier éditeur qu'un compte existant) ; une seule transaction, tout ou rien |
| Code des phases 3, 4 et 5 | fusionné dans `main` et déployé. En attendant la mise à jour de la base, les écrans concernés l'indiquent (« disponible après la mise à jour de la base ») au lieu d'échouer ; la cloche des notifications n'apparaît qu'une fois la base à jour. Fonctionnent déjà : exports Zwift et Garmin (seul leur historique attend la base), application installable, progression (volumes prévus, intensité, seuils). Dès la base à jour, tout s'active sans nouveau déploiement |
| Projet Vercel `new` | en ligne sur https://new-bay-one-76.vercel.app ; variables de Strava à ajouter (README, « Activer Strava ») |
| Contrôle de la production | après chaque déploiement de `main`, la CI (« Production ») vérifie le site en ligne sans compte ni secret : santé et Supabase, version déployée, pages, en-têtes de sécurité, HTTPS imposé, fichiers de l'application installable, refus des visiteurs anonymes (`scripts/production-smoke.mjs`) |
| Réglages d'authentification Supabase | faits le 18 octobre (Site URL, Redirect URLs, confirmation d'email désactivée en attendant un SMTP) |
| Realtime en production | contrôlé le 18 octobre ; le canal `self:<id>` de la phase 3 utilise la même politique |

Accès des connecteurs : Vercel lit le projet, les variables (noms) et crée des déploiements, mais ses journaux de build et d'exécution sont refusés (403 sur l'espace `geraldegea12-9585`) ; Supabase lit et interroge la base, mais ses migrations demandent une confirmation qui ne s'affiche pas ici : elles s'appliquent depuis l'éditeur SQL.

Avertissements de l'analyseur Supabase acceptés : les fonctions d'invitation et de relation coach-athlète (`create_invitation`, `accept_invitation`, `get_invitation_preview`, `revoke_invitation`, `revoke_coach_link`, `set_coach_permissions`, `current_user_is_admin`) et celles des phases 3 à 5 appelables par un utilisateur (`associate_activity`, `dissociate_activity`, `purge_my_expired_activities`, `athlete_sync_status`, `admin_connection_counts`, `mark_notifications_read`, `admin_accounts`, `admin_set_admin`, `delete_my_account`) vérifient elles-mêmes l'appelant. « Leaked password protection » : réglage d'authentification à activer.

## Limites connues

- Strava n'a pas pu être appelé depuis cet environnement (seuls les registres de paquets et GitHub sont joignables) : tout est vérifié contre un faux Strava qui reproduit l'API documentée. Le premier vrai branchement se fait en production, après création de l'application Strava.
- Bouton officiel « Connect with Strava » et logo « Powered by Strava » : les fichiers officiels n'ont pas pu être téléchargés ici ; un bouton texte « Connecter Strava » les remplace. À intégrer avant toute revue Strava (au-delà de 10 athlètes).
- Le coach ne voit pas les activités Strava de ses athlètes (règle de Strava) : pour lui, une séance est « terminée » grâce au retour de l'athlète ou à un fichier FIT importé.
- La synchronisation de secours tourne une fois par jour (limite de l'offre Hobby de Vercel) ; les webhooks font l'essentiel en quelques minutes.
- Exports : fichiers validés par le SDK FIT officiel et par un décodeur indépendant, mais pas encore essayés sur une vraie montre ni dans Zwift (impossible d'ici). En course, Zwift rapporte les allures à l'allure 10 km de son profil, assimilée ici à l'allure seuil. Pas d'envoi direct vers Garmin, Wahoo ou Suunto : leurs API exigent une approbation de partenaire (hors V1).
- Sans service d'envoi d'emails (SMTP), Supabase n'envoie d'emails qu'aux membres de l'organisation : confirmation d'email désactivée, mot de passe oublié limité à ces membres. Une invitation nominative ne prouve donc pas l'adresse de l'athlète : le lien à usage unique reste le secret.
- Notifications dans l'application seulement : ni email (il faut un SMTP) ni notification push sur téléphone (clés VAPID à créer).
- Avertissements `npm audit` sur des dépendances de développement uniquement.

## À faire de votre côté

Dépôt GitHub : `gege12-c/new`.

1. Mettre la base à jour (2 minutes) : ouvrez https://raw.githubusercontent.com/gege12-c/new/main/supabase/production/pending.sql, sélectionnez tout le texte (Ctrl+A puis Ctrl+C) ; dans Supabase, SQL Editor, « New query », collez, puis « Run ». Résultat attendu : « Success. No rows returned ». Si un message d'erreur apparaît, rien n'a été modifié : envoyez-le-moi. Le site se met à jour tout seul (la page Administration n'affiche plus d'avertissement, la cloche apparaît). Dites-le-moi ensuite : je vérifie la base et je mets à jour le suivi des migrations.
2. Installer l'application sur votre téléphone : ouvrez https://new-bay-one-76.vercel.app dans Safari (iPhone : Partager, puis « Sur l'écran d'accueil ») ou Chrome (Android : menu ⋮, « Installer l'application »). Dites-moi si l'icône et l'ouverture en plein écran vous conviennent.
3. Créer l'application Strava et saisir les variables dans Vercel : README, sections « Projet Vercel » (variables serveur) et « Activer Strava ». Ne me communiquez aucune de ces valeurs.
4. Vous déclarer administrateur (README, « Devenir administrateur »), puis ouvrir la page Administration de TriCoach et cliquer sur « Activer la réception des activités ».
5. Tester en vrai : connectez votre compte Strava depuis votre profil (compte athlète), faites ou importez une activité qui correspond à une séance du jour, et vérifiez qu'elle s'affiche rattachée en quelques minutes.
6. Essayer les exports sur vos appareils : ouvrez une séance dans votre calendrier, rubrique « Exporter vers mes appareils ». Garmin : téléchargez le FIT et copiez-le dans le dossier GARMIN/NewFiles de la montre branchée en USB (procédure affichée sous le bouton). Zwift : téléchargez le .zwo sur l'ordinateur de Zwift et suivez la procédure affichée. Dites-moi ce que l'appareil affiche (noms d'étapes, cibles) : c'est le seul test que je ne peux pas faire d'ici.
7. Sur la page de votre application Strava, passer la capacité de 1 à 10 athlètes.
8. Pour une future revue Strava : téléchargez le pack officiel des boutons « Connect with Strava » et des logos « Powered by Strava » (developers.strava.com, rubrique Guidelines) et envoyez-le-moi dans une session ; je les intégrerai.
9. Sauvegardes : l'offre gratuite de Supabase n'en fait pas ; exportez la base de temps en temps (README, « Sauvegardes ») ou passez à l'offre Pro (sauvegardes quotidiennes).
10. Toujours valable : activer « Leaked password protection » dans Supabase ; configurer un service d'envoi d'emails (SMTP) puis réactiver « Confirm email » (il permettra aussi des notifications par email).
