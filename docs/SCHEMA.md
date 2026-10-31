# Schéma de la base

Migrations : [`supabase/migrations`](../supabase/migrations). Tests de sécurité : [`tests/db`](../tests/db).

## Conventions

- Identifiants `uuid` (sauf `audit_logs`, en identité séquentielle).
- Instants en `timestamptz` (UTC). Une séance sans heure est une **date locale** (`date`) de l'athlète, avec une heure locale facultative (`time`) : on n'en fait jamais un instant UTC, pour éviter les décalages d'un jour.
- Valeurs énumérées en `text` + `CHECK`, plus simples à faire évoluer que des types `enum`.
- `updated_at` est maintenu par trigger ; `created_by` prend `auth.uid()` par défaut et n'est jamais modifiable.

## Tables (phases 1 et 2)

```mermaid
erDiagram
  auth_users ||--|| profiles : "inscription (trigger)"
  profiles ||--|| athlete_profiles : "profil sportif"
  profiles ||--o{ coach_athlete_links : "coach_id"
  profiles ||--o{ coach_athlete_links : "athlete_id"
  profiles ||--o{ invitations : "coach_id"
  profiles ||--o{ athlete_thresholds : "athlete_id"
  profiles ||--o{ athlete_events : "athlete_id"
  profiles ||--o{ workout_templates : "owner_id"
  profiles ||--o{ planned_sessions : "athlete_id"
  workout_templates |o--o{ planned_sessions : "template_id"
  planned_sessions ||--o| planned_session_drafts : "modifications en attente"
  planned_sessions ||--o{ session_comments : "commentaires"
```

| Table | Rôle | Points clés |
| --- | --- | --- |
| `profiles` | un profil par compte | `is_coach` déclaratif ; fuseau horaire validé |
| `admin_users` | administrateurs | écrite uniquement par la clé de service ou l'éditeur SQL |
| `athlete_profiles` | objectifs, niveau, volume visé, notes | créé à l'inscription pour tout compte |
| `coach_athlete_links` | relation coach-athlète | `active` ou `revoked` ; permissions `can_edit_plan`, `can_view_activities` réglées par l'athlète ; `share_strava` et `strava_shared_at` : autorisation expresse de l'athlète à ce coach de voir ses activités Strava, désactivée par défaut, remise à zéro quand la relation est retirée ou rétablie |
| `invitations` | invitations à usage unique | seule l'empreinte SHA-256 du jeton est stockée ; nominative (email) ou par lien |
| `athlete_thresholds` | seuils historisés (FTP, FC seuil, allure seuil, CSS, FC max…) | une valeur par seuil et par date d'effet ; bornes plausibles contrôlées |
| `athlete_events` | compétitions | priorité A, B ou C |
| `workout_templates` | bibliothèque de séances du coach | contenu au format v1 |
| `planned_sessions` | séances planifiées | `draft`, `published`, `cancelled` ; `version` incrémentée à chaque modification ; écrite par fusion champ par champ (voir plus bas) |
| `planned_session_drafts` | modifications en attente d'une séance publiée (ou annulée) | une ligne au plus par séance ; `base` = version publiée au début de l'édition (fixée par trigger), `payload` = état voulu ; invisible pour l'athlète |
| `session_comments` | commentaires de séance | `shared` (athlète et coachs) ou `coach_private` (visible de son seul auteur) ; texte modifiable par l'auteur, visibilité figée |
| `audit_logs` | historique des modifications | alimenté par triggers, en lecture seule ; `visibility = 'coaches'` pour une séance restée brouillon |

Tables prévues dans les phases suivantes : `external_connections`, `activities`, `activity_streams`, `session_activity_matches`, `sync_jobs`, `sync_logs` (phase 3), `workout_exports` (phase 4), `notifications` (phase 5).

## Sécurité

Le rôle `anon` n'a accès à aucune table. Le rôle `authenticated` reçoit des droits explicites, colonne par colonne quand c'est utile, puis chaque ligne est filtrée par une politique RLS.

| Donnée | Lecture | Écriture |
| --- | --- | --- |
| Profil | soi-même, personnes liées, administrateurs | soi-même |
| Profil sportif | l'athlète et ses coachs actifs | l'athlète |
| Seuils, compétitions | l'athlète et ses coachs actifs | l'athlète, ou un coach autorisé à planifier |
| Séances planifiées | l'athlète (hors brouillons du coach) et ses coachs actifs | l'athlète pour ses propres séances ; un coach autorisé à planifier ; l'athlète peut seulement **déplacer** les séances de son coach |
| Modifications en attente | qui peut modifier le contenu de la séance (jamais l'athlète pour une séance du coach) | idem |
| Commentaires partagés | qui voit la séance | l'athlète et ses coachs actifs ; texte modifiable et suppression par l'auteur |
| Notes privées | leur auteur, tant qu'il coache l'athlète | un coach de l'athlète |
| Modèles | leur propriétaire | leur propriétaire |
| Relations, invitations | les deux parties / le coach | uniquement via les fonctions ci-dessous |
| Journal d'audit | l'athlète et ses coachs actifs | personne (triggers) |

Fonctions d'autorisation (schéma `private`, non exposé par l'API) : `is_admin`, `is_coach_of`, `coach_can_plan`, `has_athlete_access`, `can_plan_for`, `is_linked_with`.

Procédures exposées (RPC) :

| Fonction | Usage |
| --- | --- |
| `create_invitation(email?, heures)` | coach : crée une invitation, renvoie le jeton une seule fois (20 invitations en attente au maximum) |
| `get_invitation_preview(jeton)` | tout visiteur : nom du coach et état de l'invitation |
| `accept_invitation(jeton)` | athlète connecté : active la relation (adresse confirmée exigée pour une invitation nominative) |
| `revoke_invitation(id)` | coach : annule une invitation non utilisée |
| `revoke_coach_link(id)` | coach ou athlète : met fin à la relation |
| `set_coach_permissions(id, planifier, voir_activités)` | athlète : règle les droits de son coach |
| `athlete_thresholds_at(athlète, date)` | seuils en vigueur à une date, selon les droits de l'appelant |
| `current_user_is_admin()` | l'utilisateur courant est-il administrateur |
| `save_planned_session(séance, base, valeurs)` | enregistre une séance par fusion (voir ci-dessous) ; sert aussi aux déplacements |
| `save_session_draft(séance, base, valeurs)` | enregistre les modifications en attente d'une séance publiée, par fusion ; les supprime si elles redeviennent identiques à la version publiée |
| `publish_session_draft(séance, préférence?)` | publie les modifications en attente ; `préférence` (`mine` ou `theirs`) tranche un conflit |
| `rebase_session_draft(séance, préférence)` | recale les modifications en attente sur la version publiée actuelle, sans publier |
| `duplicate_planned_session(séance, date)` | copie une séance (une séance annulée revient en brouillon) |
| `copy_planned_week(athlète, lundi source, lundi cible, état?)` | copie une semaine jour pour jour, sans les séances annulées, en une transaction |

### Fusion champ par champ

L'éditeur envoie l'état qu'il a chargé (`base`) et l'état voulu. Seuls les champs qui diffèrent de `base` sont écrits. Si l'un d'eux a aussi été changé en base entre-temps, avec une autre valeur, rien n'est écrit : l'erreur `session_conflict` (code `PT409`, HTTP 409) liste les champs en conflit et l'interface demande quelle version garder. Les autres changements faits ailleurs (un déplacement par l'athlète, par exemple) sont conservés et repris par l'éditeur. Les verrous sont pris dans le même ordre partout (séance, puis modifications en attente).

### Temps réel

Les triggers `broadcast_planned_sessions` et `broadcast_session_comments` envoient un message `planning_changed` (Realtime Broadcast) sur le canal privé `athlete:<id>` à chaque changement visible par l'athlète. Le message ne contient que des identifiants ; les brouillons, les commentaires de brouillons et les notes privées n'en envoient pas. La politique `athlete_topic_receive` de `realtime.messages` réserve l'écoute du canal à l'athlète et à ses coachs actifs.

Les erreurs métier sont levées avec un code stable (`invitation_expired`, `athlete_can_only_reschedule`…), traduit par `src/lib/errors.ts`.

## Activités réalisées (phase 3)

Migration `20261019000000_activities.sql`.

```mermaid
erDiagram
  profiles ||--o| external_connections : "compte Strava relié"
  external_connections ||--|| oauth_tokens : "jetons chiffrés"
  external_connections ||--o{ activities : "activités Strava (cascade)"
  profiles ||--o{ activities : "athlete_id"
  planned_sessions ||--o{ session_activity_matches : "séance"
  activities ||--o{ session_activity_matches : "activité"
  planned_sessions ||--o| session_completions : "retour de l'athlète"
  profiles ||--o{ sync_jobs : "file de synchronisation"
  sync_jobs ||--o{ sync_logs : "journal technique"
```

| Table | Rôle | Points clés |
| --- | --- | --- |
| `external_connections` | compte Strava relié par l'athlète | une connexion par athlète et par fournisseur ; un compte Strava n'est relié qu'à un seul compte TriCoach ; seul l'identifiant Strava est conservé (aucun nom ni profil) ; `status` = `active` ou `reauth_required` ; `last_error` = code stable |
| `oauth_tokens` | jetons OAuth | chiffrés par l'application (AES-256-GCM, clé `TOKEN_ENCRYPTION_KEY` hors de la base, préfixe `v1.` contrôlé) ; aucun privilège ni politique : invisibles par l'API, lus par le seul serveur ; `revision` évite qu'un renouvellement en écrase un autre |
| `activities` | activités réalisées, normalisées | `source` = `strava` ou `fit_upload` ; unicité par `(athlete_id, source, external_id)` et, pour Strava, par identifiant d'activité tous comptes confondus ; instant de départ en UTC + date et heure locales de l'athlète ; mesures bornées (une valeur aberrante devient « non mesurée ») ; Strava : `expires_at` obligatoire, au plus 7 jours après la première lecture, jamais repoussé |
| `session_activity_matches` | rapprochements séance-activité | `auto` (rapprochement automatique), `confirmed` (décision de l'athlète ou du coach), `proposed` (à valider), `rejected` (écartée, jamais reproposée) ; une activité n'est rattachée qu'à une séance à la fois ; `score` et `score_details` expliquent la note |
| `session_completions` | retour de l'athlète sur une séance | `done`, `partial` ou `skipped`, RPE de 1 à 10, note (500 caractères) ; `athlete_id` recopié de la séance par trigger ; prime sur la mesure pour le statut affiché |
| `sync_jobs` | file de jobs (évènements Strava, synchronisations, maintenance) | `dedupe_key` unique : un évènement reçu deux fois ne crée qu'un job ; reprise avec attente exponentielle (2^n minutes, 6 h au plus, 6 essais) ; un report pour quota ne compte pas comme un échec ; paramètres vidés une fois le job terminé |
| `sync_logs` | journal technique | évènement et message, jamais de donnée sportive ; effacé après 30 jours |
| `provider_state` | état de l'intégration Strava | abonnement webhook (un seul par application), derniers quotas lus, suspension jusqu'à la prochaine fenêtre |

### Sécurité des activités

| Donnée | Lecture | Écriture |
| --- | --- | --- |
| Connexion Strava | l'athlète | le serveur seul (clé secrète) |
| Jetons OAuth | personne par l'API | le serveur seul |
| Activités Strava | **l'athlète**, et les coachs qu'il autorise expressément (`share_strava`), jusqu'à leur expiration (politique Strava : consentement exprès, §5.13 ; cache de 7 jours au plus, §6.2) | le serveur seul |
| Activités importées (FIT) | l'athlète, et ses coachs qu'il autorise à « voir ses activités importées » | l'athlète (import, suppression) |
| Rapprochements | comme l'activité et la séance concernées (un coach ne voit un rapprochement avec une activité Strava que si l'athlète l'autorise) | fonctions `associate_activity` et `dissociate_activity` (pour une activité Strava : l'athlète seul), et le rapprochement automatique |
| Retour de séance | l'athlète et ses coachs actifs | l'athlète |
| File, journal, état Strava | les administrateurs (sans les paramètres des jobs) | le serveur seul |

Temps réel : ce qui touche une activité Strava part sur le canal `self:<id>`, que seul l'athlète peut écouter, et sur `strava:<id>` quand au moins un coach est autorisé à voir ses activités Strava (l'athlète et ces coachs seulement) ; les retours de séance et les fichiers FIT sur `athlete:<id>` (athlète et coachs actifs).

### Fonctions des activités

| Fonction | Usage |
| --- | --- |
| `associate_activity(séance, activité)` | rattache une activité (décision `confirmed`, jamais remise en cause par le rapprochement automatique) ; l'ancien rattachement devient `rejected` |
| `dissociate_activity(séance, activité)` | détache une activité ou écarte une proposition (`rejected`) |
| `upsert_strava_activities(connexion, activités)` | serveur : enregistre ou met à jour des activités Strava, sans jamais repousser leur expiration ni toucher à l'activité d'un autre compte |
| `claim_sync_jobs(n, types[])` | serveur : réserve les jobs à exécuter des types demandés (`skip locked`), reprend ceux bloqués depuis plus de 10 minutes ; chaque intégration ne prend que les siens |
| `run_maintenance()` | serveur : efface les activités Strava expirées, les jobs terminés depuis 7 jours, le journal de plus de 30 jours |
| `purge_my_expired_activities()` | athlète : efface ses activités Strava expirées sans attendre la tâche quotidienne |
| `set_strava_sharing(relation, oui/non)` | athlète : autorise un de ses coachs à voir ses activités Strava, ou retire cette autorisation (date du consentement gardée tant qu'il dure) |
| `athlete_sync_status(athlètes[])` | état des connexions (statut, dernière synchronisation, code d'erreur) des athlètes auxquels l'appelant a accès |
| `admin_connection_counts()` | administrateur : nombre de comptes reliés par statut (capacité de l'application Strava) |

### Rapprochement automatique

`private.rematch_window(athlète, du, au)` recalcule les rapprochements d'une fenêtre de dates, sous un verrou par athlète, à chaque arrivée, modification ou suppression d'activité et à chaque changement de séance (date, heure, discipline, durée, état). Les décisions de l'utilisateur (`confirmed`, `rejected`) ne sont jamais modifiées.

- Note (`private.match_score`) : discipline obligatoire (natation, vélo, course ; renforcement et « autre » se rapprochent entre eux), puis 45 % date (même jour 1, veille ou lendemain 0,35), 20 % heure (écart linéaire sur 4 h, 0,6 sans heure), 35 % volume (rapport de durée, sinon de distance, sur une échelle logarithmique : 1/3 ou ×3 donne 0).
- Un enchaînement est découpé en segments (vélo, course…) : chaque activité peut en occuper un.
- Rattachement automatique à partir de 0,68, seulement sans ambiguïté (aucune autre séance ou activité à moins de 0,12, sauf si celle-ci revient nettement à une autre) ; sinon, les deux meilleures séances à partir de 0,45 sont proposées à l'athlète.
- Les brouillons et les séances annulées ne reçoivent rien ; deux séances du même jour se départagent par l'heure et la durée.

Statut affiché d'une séance publiée : le retour de l'athlète s'il existe (faite, partielle, manquée) ; sinon une activité rattachée (terminée au-delà de 80 % du prévu, partielle en deçà) ; sinon « à rapprocher » si elle est passée. Une séance n'est jamais supposée manquée.

## Exports de séances (phase 4)

Migration `20261020000000_workout_exports.sql`. Règles de conversion : [EXPORTS.md](EXPORTS.md).

| Table | Rôle | Points clés |
| --- | --- | --- |
| `workout_exports` | historique des exports de séances prévues (.zwo, FIT) | une ligne par tentative, réussie (`succeeded` : nom, taille, empreinte SHA-256 du fichier) ou non (`failed` : message) ; `provider` = `zwift` (format `zwo`) ou `garmin` (format `fit`) ; `segment_index` = partie d'un enchaînement ; `session_version` = version de la séance exportée (le panneau signale un fichier périmé) ; `issues` = écarts du contrôle de compatibilité ; `athlete_id` recopié de la séance et `requested_by` fixé à l'utilisateur connecté par trigger ; disparaît avec la séance |

Sécurité : lecture par l'athlète et ses coachs actifs ; ajout par l'un d'eux, pour une séance qu'il peut lire (la politique interroge `planned_sessions` sous ses propres droits : un athlète n'exporte pas un brouillon qu'il ne voit pas) ; ni modification ni suppression par l'API.

## Notifications (phase 5)

Migration `20261021000000_notifications.sql`.

| Table | Rôle | Points clés |
| --- | --- | --- |
| `notifications` | notifications dans l'application | écrites par la base seule (triggers, tâche quotidienne), jamais par l'API ; `kind` = `session_published`, `session_updated`, `session_cancelled`, `comment`, `reconnect`, `export_failed`, `missing_feedback` ; `payload` = libellés figés (titre et date de séance, fournisseur, extrait de commentaire), jamais de donnée Strava ; l'auteur d'un changement n'est jamais prévenu ; plusieurs séances publiées en dix minutes par le même auteur donnent une notification groupée, plusieurs modifications d'une même séance une seule notification mise à jour ; effacées après 60 jours |
| `notification_preferences` | types coupés par l'utilisateur | `disabled_kinds` ; tout est actif par défaut |

Qui est prévenu : l'athlète et ses coachs actifs pour une séance publiée, modifiée, déplacée ou annulée et pour un commentaire partagé (jamais une note privée ; un brouillon ne concerne que les coachs) ; l'athlète seul pour une reconnexion Strava et pour une séance de la veille sans retour ni activité rattachée (tâche quotidienne, date locale de l'athlète, une fois par séance) ; les coachs autorisés à planifier quand un export de l'athlète échoue.

Sécurité : chacun ne lit que ses notifications et ne peut modifier que `read_at` (fonction `mark_notifications_read`) ; ses réglages sont les siens ; `notify_missing_feedback` est réservée à la clé de service.

## Comptes et rôles (phase 5)

Migration `20261021100000_admin_accounts.sql` : `admin_accounts()` liste les comptes pour un administrateur (nom, email, mode coach, administrateur, inscription, dernière connexion, nombre de relations), sans aucune donnée sportive ; `admin_set_admin(compte, oui/non)` donne ou retire le rôle d'administrateur, jamais au dernier administrateur. Les deux vérifient l'appelant (`forbidden` sinon).

## Suppression du compte (phase 5)

Migration `20261022000000_account_deletion.sql` : `delete_my_account()`, sans paramètre, supprime le compte de l'utilisateur connecté, en une transaction :

- partent avec lui (cascade depuis `auth.users`) : profil, profil sportif, seuils, compétitions, séances, modifications en attente, commentaires, déclarations, activités et rapprochements, exports, notifications et réglages, connexions et jetons, montres associées, relations, invitations, modèles, rôle d'administrateur ;
- en tant que coach : ses modifications en attente et les séances restées brouillon chez ses athlètes sont effacées ; ses séances publiées restent chez l'athlète, sans auteur (`created_by`, `updated_by` et `template_id` passent à null) ;
- journal d'audit : les entrées qui concernent le compte (ses données, ses invitations) sont effacées ; ses actions dans l'historique des autres deviennent anonymes (`actor_id` à null) ;
- `guard_planned_session` n'inscrit plus comme dernier éditeur qu'un profil existant : sans ce changement, la clé étrangère « on delete set null » réécrivait les séances du coach avec son propre identifiant et la suppression échouait.

L'application révoque l'accès Strava avant l'appel (elle seule déchiffre les jetons) ; si Strava ne répond pas, la connexion et les jetons sont tout de même effacés et l'utilisateur est prévenu de retirer TriCoach dans ses réglages Strava. L'export des données personnelles (`GET /api/me/export`) lit tout sous les droits de l'utilisateur, sans les activités Strava ni leurs rapprochements.

## Montre Garmin (phase 5)

Migration `20261024000000_garmin_watch.sql`. Application de la montre et routes : [GARMIN_WATCH.md](GARMIN_WATCH.md). Association par code, sur le modèle du « device flow » d'OAuth (RFC 8628).

| Table | Rôle | Points clés |
| --- | --- | --- |
| `watch_pairings` | associations en cours | code de 8 caractères sans ambiguïté de lecture (`user_code`, unique tant qu'il attend), code de la montre gardé sous forme d'empreinte (`device_code_hash`) ; 10 minutes de validité ; aucune lecture ni écriture par l'API |
| `watch_devices` | montres associées | « en attente » dès la saisie du code (`connected_at` et `token_hash` nuls), connectée à la remise du jeton (empreinte SHA-256, unique) ; `last_seen_at` = dernier contact ; révocable (`revoked_at`) ; 5 montres actives au plus par athlète ; disparaît avec le compte |

| Fonction | Usage |
| --- | --- |
| `start_watch_pairing(nom?)` | montre (sans compte) : nouveau code ; associations abandonnées effacées après un jour ; limitée à 500 demandes par 10 minutes pour tout le service |
| `confirm_watch_pairing(code)` | athlète connecté : saisie du code (minuscules, tiret et espaces tolérés) ; la montre apparaît aussitôt dans son profil |
| `claim_watch_token(code de la montre)` | montre : jeton remis une seule fois (`ready`), sinon `pending`, `claimed`, `expired` ou `unknown` |
| `revoke_watch_device(montre)` | athlète : dissocie sa montre ; le jeton ne vaut plus rien aussitôt |
| `watch_sessions(jeton)` | montre : séances publiées d'aujourd'hui à J+6 (date locale de l'athlète) et seuils, ou `unauthorized` ; met à jour `last_seen_at` |

Sécurité : RLS active, tous les privilèges retirés sur les deux tables ; l'athlète lit seulement les colonnes non sensibles de ses montres (ni empreinte ni code) ; tout le reste passe par les fonctions, qui vérifient l'appelant.

## Séances sur la montre (Suunto, Garmin, COROS)

Migration `20261030000000_device_workouts.sql`. Fonctionnement et limites : [WATCHES.md](WATCHES.md).

| Table ou colonne | Rôle | Points clés |
| --- | --- | --- |
| `external_connections` | comptes reliés : `strava`, `intervals` (clé API personnelle), `suunto` (OAuth) | `sync_lease_until` : un seul envoi à la fois par compte ; identifiant externe de 100 caractères au plus |
| `oauth_tokens` | clé API intervals.icu ou jetons Suunto | chiffrés comme ceux de Strava (AES-256-GCM, données associées = connexion) |
| `device_workouts` | une ligne par séance et par discipline envoyée à un compte | `external_id` = `tricoach-<séance>-<partie>` (unique par compte, identifiant de l'évènement chez le fournisseur) ; `remote_id` (identifiant chez le fournisseur), `session_version` et `content_hash` (empreinte SHA-256 de ce qui a été envoyé : rien n'est renvoyé tant qu'elle ne change pas) ; `status` = `sent` ou `failed` (avec `issues` et `last_error`, raison lisible) ; `session_id` mis à nul si la séance disparaît, pour la retirer chez le fournisseur |
| `sync_jobs` | types `intervals_sync` et `suunto_sync` | un job par compte relié actif, dédoublonné tant qu'il attend |

| Fonction | Usage |
| --- | --- |
| `private.enqueue_device_sync(athlète)` | met un envoi en file pour chaque compte relié actif de l'athlète (intervals.icu, Suunto) ; appelée par les déclencheurs `planned_sessions_devices` (séance publiée créée, modifiée, déplacée, annulée, supprimée ou repassée en brouillon) et `athlete_thresholds_devices` (seuils, qui changent les cibles absolues) |
| `acquire_sync_lease(connexion, secondes)` / `release_sync_lease(connexion)` | serveur : bail d'envoi par compte, pour qu'un envoi déclenché par le coach et la tâche quotidienne ne se croisent pas |

Sécurité : `device_workouts` lisible par l'athlète et ses coachs actifs (`has_athlete_access`), écrite par le serveur seul ; les fonctions ne sont accessibles qu'au serveur (`service_role`).

### Activités reçues d'intervals.icu et doublons

Migration `20261031000000_intervals_activities.sql`.

| Table ou colonne | Rôle | Points clés |
| --- | --- | --- |
| `activities.source` | `strava`, `fit_upload` ou `intervals` (activités de la montre reçues par intervals.icu) | `intervals` : durable comme un fichier (ni connexion ni expiration), écrite par le serveur seul (aucune politique d'ajout ni de suppression pour l'API), lisible comme un fichier importé (l'athlète, et ses coachs autorisés à voir ses activités) |
| `activities.source_load` | charge d'entraînement calculée par la source (intervals.icu : `icu_training_load`, avec ses propres seuils) | 0 à 2000, une décimale ; écrite par le serveur seul ; reprise telle quelle par la courbe de condition (migration `20261031070000`) |
| `external_connections.history_from` | plus ancien jour d'activités demandé à intervals.icu | un an reçu une fois, puis les 14 derniers jours ; vide : l'historique sera demandé au prochain passage |
| `activities.duplicate_of` | même séance faite, arrivée par une autre source : l'original | jamais rapprochée, comptée ni affichée ; original effacé : le doublon le remplace (`on delete set null`, puis nouvelle résolution) |
| `external_connections.activities_synced_at`, `activities_skipped` | dernière réception des activités, et activités qu'intervals.icu n'a pas transmises (reçues de Strava) | la première réception remonte à 90 jours, les suivantes à 14 |

| Fonction | Usage |
| --- | --- |
| `private.same_workout(a, b)` | même athlète, sources différentes, même discipline, départ à 5 minutes près (heure locale comprise), durée à 20 % près |
| `private.resolve_activity_duplicates(activité)` | désigne l'original du groupe (fichier ou montre avant Strava, puis le premier arrivé), marque les doublons, reporte sur l'original un rattachement confirmé et les séances écartées, puis recalcule les rapprochements ; appelée par le déclencheur `activities_dedupe`, qui passe avant `activities_rematch` |
| `private.rematch_window` | ignore désormais les doublons |
| `schema_version()` | dernière migration inscrite dans l'historique Supabase, lisible sans compte : le contrôle de production (`/api/health`) dit si la base attend sa mise à jour |

### Courbes des activités

Migration `20261031050000_activity_streams.sql`.

| Table | Rôle | Points clés |
| --- | --- | --- |
| `activity_streams` | courbes réduites d'une activité (puissance, fréquence cardiaque, vitesse, cadence, altitude, distance, alignées sur le temps), ses intervalles (détectés par intervals.icu, ou tours de l'appareil) et ses meilleures puissances (5 s à 60 min, calculées seconde par seconde avant réduction) | une ligne par activité (clé : `activity_id`, effacée avec l'activité) ; 720 points au plus par courbe ; jamais de trace GPS ni de courbe Strava. Lecture : celle de l'activité (la sous-requête de la politique applique la RLS des activités). Écriture : le serveur pour intervals.icu, l'athlète pour ses propres fichiers FIT (une fois, ni modification ni effacement à la main). Une ligne aux séries vides note une activité sans courbe chez intervals.icu (pas relue). |

## Notes de calendrier et jours indisponibles

Migration `20261031010000_calendar_notes.sql`.

| Table | Rôle | Points clés |
| --- | --- | --- |
| `calendar_notes` | jours indisponibles (`unavailable`, `travel`, `sick`, `injured`, `holiday`) et simples notes (`note`) du calendrier d'un athlète | période `start_date` à `end_date` (dates locales, un an au plus) ; intitulé (80 caractères) et précisions (500) ; auteur (`created_by`, mis à nul si son compte disparaît) ; journalisée ; signalée en temps réel sur `athlete:<id>` |

Sécurité : lecture par l'athlète et ses coachs actifs (`has_athlete_access`, comme les compétitions) ; ajout par l'athlète ou un coach qui planifie pour lui (`can_plan_for`), l'auteur étant toujours l'utilisateur connecté ; modification et retrait par l'auteur, et par l'athlète sur son propre calendrier.

## Forme du jour

Migration `20261031020000_wellness.sql`.

| Table | Rôle | Points clés |
| --- | --- | --- |
| `wellness_entries` | forme du jour d'un athlète, une ligne par date locale (clé `athlete_id`, `entry_date`) | échelles de 1 à 5 (qualité du sommeil et motivation : 5 = au mieux ; fatigue, courbatures, stress : 5 = au pire), durée du sommeil (h), FC au repos (bpm), VFC (ms), poids (kg), mot pour le coach (300 caractères) ; valeurs bornées ; au moins une valeur par ligne |

Sécurité : écrite, modifiée et effacée par l'athlète seul ; lue par lui et par les coachs qu'il autorise à voir ses activités (`coach_can_view_activities`, même autorisation que les fichiers importés, libellée « Peut voir mes activités et ma forme du jour »). Effacée avec le compte ; incluse dans l'export des données personnelles.

## Agenda du téléphone

Migration `20261031030000_calendar_feeds.sql`. Route `GET /api/calendar/<jeton>.ics` (iCalendar, sans compte).

| Table | Rôle | Points clés |
| --- | --- | --- |
| `calendar_feeds` | adresse d'abonnement de l'agenda d'un athlète (une au plus) | empreinte SHA-256 du jeton seulement (jeton de 244 bits, montré une fois) ; date de création et de dernière lecture (mise à jour au plus toutes les 10 minutes) |

| Fonction | Usage |
| --- | --- |
| `create_calendar_feed()` | athlète connecté : nouvelle adresse (remplace l'ancienne, qui cesse aussitôt de fonctionner) ; rend le jeton |
| `revoke_calendar_feed()` | athlète connecté : retire son adresse |
| `calendar_feed(jeton)` | sans compte : séances publiées et annulées (pour les retirer des agendas) de J−60 à J+180, seuils, compétitions et jours indisponibles de l'athlète du jeton ; `unauthorized` sinon |

Sécurité : aucune écriture directe ; l'athlète lit seulement l'existence et les dates de son adresse, jamais l'empreinte ; la fonction de lecture ne rend que les données de l'athlète du jeton.

## Plans d'entraînement

Migration `20261031040000_training_plans.sql`.

| Table | Rôle | Points clés |
| --- | --- | --- |
| `training_plans` | plans du coach (bibliothèque personnelle, comme les modèles) | nom, description, 1 à 26 semaines ; lus et modifiés par leur propriétaire seul |
| `training_plan_sessions` | séances d'un plan | jour dans le plan (`day_offset`, 0 = lundi de la semaine 1), heure, discipline, titre, objectif, consignes, nutrition, contenu structuré validé comme une séance, totaux prévus |

| Fonction | Usage |
| --- | --- |
| `save_training_plan(athlète, lundi, semaines, nom, description)` | enregistre en plan les séances visibles de l'appelant sur ces semaines (publiées et brouillons, sans les annulées) ; refuse un jour autre que lundi, une période vide, un athlète inaccessible |
| `apply_training_plan(plan, athlète, lundi, publier)` | crée les séances du plan chez l'athlète à partir de ce lundi, en brouillon ou publiées |

Les deux fonctions sont « security invoker » : la RLS et les déclencheurs des séances (droits de planification, journal, temps réel, envoi vers la montre, notifications) s'appliquent comme pour toute création de séance.

## Journal d'audit

Chaque création, modification et suppression sur les profils sportifs, relations, invitations, seuils, compétitions et séances est enregistrée avec son auteur. Pour une modification, seules les colonnes changées sont conservées (ancienne et nouvelle valeur). Le contenu structuré d'une séance est noté « modifié » sans être recopié, car l'enregistrement automatique le réécrit souvent.
