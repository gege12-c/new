# Accès partenaires (envoi automatique vers les montres)

Demandé le 19 octobre 2026 : qu'une séance créée dans TriCoach arrive seule sur la montre, et que l'activité faite revienne seule, visible du coach. Garmin, Suunto, Zwift et MyWhoosh n'ouvrent cet accès qu'à des partenaires agréés ; vérifications faites le 19 octobre 2026 (sources en fin de page).

Choix de l'utilisateur (19 octobre) : passer par les accès directs de Garmin et de Suunto, sans intermédiaire ; le relais par intervals.icu (déjà agréé par les quatre) est écarté pour l'instant. Le même jour, Strava a confirmé à l'utilisateur que le coach peut voir les activités Strava d'un athlète qui l'y autorise : le partage est en place (voir [STATUS.md](STATUS.md)).

| Fournisseur | Accès pour TriCoach | État |
| --- | --- | --- |
| Garmin | Garmin Connect Developer Program (API Training pour envoyer les séances, API Activity pour recevoir les activités), réservé aux entreprises, gratuit | **demandes suspendues** depuis le printemps 2026 : formulaire indisponible, « new access requests are temporarily paused », aucune date de reprise. Les intégrations déjà agréées continuent. En attendant : **application TriCoach sur la montre** (Connect IQ, ouvert à tout développeur), voir [GARMIN_WATCH.md](GARMIN_WATCH.md) |
| Suunto | programme partenaire (API Guides pour envoyer les séances comme guides SuuntoPlus, API Workout pour recevoir les activités en FIT), réservé aux entreprises et organisations qui proposent un service au public, gratuit, examen chaque semaine (deux semaines au plus), contrat API accepté dans le formulaire | **demande à envoyer** par l'utilisateur (texte ci-dessous) |
| Zwift | aucune API publique | fichier .zwo à importer (rubrique « Exporter vers mes appareils ») |
| MyWhoosh | aucune API publique ni intégration directe pour les plateformes d'entraînement | fichier .zwo à importer dans le créateur de séances de MyWhoosh |

## Demande Suunto

À envoyer sur https://www.suunto.com/welcomepartners, au nom de TriCoach (entreprise ou statut d'auto-entrepreneur), en ajoutant l'adresse du développeur et en acceptant le contrat API. Les champs d'identité (raison sociale, adresse, numéro d'immatriculation, contact) sont à remplir par l'utilisateur ; aucun n'est noté ici.

Texte de présentation (en anglais, pour les champs de description et d'usage) :

```text
Service: TriCoach, https://new-bay-one-76.vercel.app (web app, installable on phones)

What TriCoach does
TriCoach is a triathlon coaching platform. Coaches plan structured workouts for their athletes in the browser: swim, bike, run, strength and multisport bricks, with warm-up, intervals, repeats and targets in power, pace, heart rate, cadence or RPE. Athletes see their plan in a mobile-first calendar as soon as it is published. After each session, what was done is compared with what was planned (duration, distance, intensity), so the coach can adjust the following weeks.

What we want to build with Suunto
1. Planned workouts on the watch (Guides API): each workout planned in TriCoach is sent to the athlete's Suunto account as a SuuntoPlus Guide for the coming days, updated when the coach changes it and removed if it is cancelled. Today, our Suunto users have to rebuild every workout by hand in the Suunto app.
2. Completed workouts back in TriCoach (Workout API): Suunto workouts are imported as FIT files, matched with the planned session and shown to the athlete, and to their coach only if the athlete has allowed it.

Users
We are starting with one coach and a small group of athletes, and the platform is built to grow. The interface is in French; our users are triathletes in France.

Data protection
- OAuth 2.0 only; access tokens are encrypted at rest (AES-256-GCM) and never leave our servers.
- Hosted in Europe: database in Zurich, application servers in Frankfurt.
- Access rules are enforced by the database itself: a coach sees an athlete's data only with that athlete's explicit permission.
- Athletes can disconnect Suunto at any time: access is revoked and the imported Suunto data is deleted.
- No data is sold or shared with third parties, and Suunto data is not used to train or feed AI models.

Branding
We will follow Suunto's partner guidelines and use the "Compatible with Suunto" assets you provide.

Commercial interest
TriCoach is free for its users at this stage.
```

Après acceptation : abonnement à l'API de développement sur l'APIZone (toutes les routes, quotas réduits), construction du connecteur (guides des 7 prochains jours mis à jour à chaque modification, import des activités en FIT avec rapprochement et droits du coach), puis passage en production (fiche du service à soumettre à Suunto). Les identifiants de l'application Suunto se saisissent dans Vercel par l'utilisateur, comme ceux de Strava.

## Autres pistes étudiées le 19 octobre 2026

Questions de l'utilisateur : une application TriCoach sur la montre Suunto, comme pour Garmin ? une application Android (APK) qui enverrait les séances aux montres ?

| Piste | Verdict | Pourquoi |
| --- | --- | --- |
| Application sur la montre Garmin (Connect IQ) | **faite** ([GARMIN_WATCH.md](GARMIN_WATCH.md)) | une application Connect IQ peut télécharger un fichier de séance par le téléphone (application Garmin Connect) et l'enregistrer en séance Garmin ; seule limite : pas d'enregistrement en tâche de fond, donc une confirmation sur la montre |
| Application sur la montre Suunto (SuuntoPlus) | **impossible aujourd'hui** | depuis mars 2026, tout le monde peut créer des applications SuuntoPlus (JavaScript, éditeur gratuit), mais elles ne joignent ni Internet ni un service comme TriCoach : seulement les capteurs de la montre et des appareils Bluetooth ; une application installée soi-même est effacée par l'application Suunto à la synchronisation ; la publication dans la boutique SuuntoPlus passe par le programme partenaire. Ce qui arrive sur la montre par Bluetooth vient du compte Suunto de l'athlète, alimenté par Suunto et ses partenaires (comme TrainingPeaks) : c'est la demande Suunto ci-dessus |
| Application de téléphone relais vers la Suunto (Bluetooth) | **écartée** | une application de téléphone pourrait se présenter comme un appareil Bluetooth à une application SuuntoPlus ; il faudrait une application native (hors V1), ouverte pendant la séance, et l'application de la montre devrait quand même être publiée par Suunto |
| Application Android (APK) qui envoie les séances aux montres | **écartée** | Garmin n'accepte une séance que de ses partenaires ou d'une application installée sur la montre ; Suunto, que de ses partenaires ; Android interdit à une application d'écrire dans les fichiers de Zwift ou de MyWhoosh. TriCoach s'installe déjà comme une application sur Android (Chrome, « Ajouter à l'écran d'accueil ») |
| Accès non officiel à Garmin Connect (identifiants de l'athlète) | **refusée** | contraire aux conditions de Garmin, mot de passe de l'athlète à garder, casse à chaque changement de Garmin |

## Garmin, quand les demandes rouvriront

Surveiller https://developer.garmin.com/gc-developer-program/ : le formulaire de demande y reviendra. La même présentation servira, en demandant l'API Training (séances et plans envoyés vers Garmin Connect, puis la montre) et l'API Activity (activités reçues). D'ici là, le fichier FIT de séance se copie sur la montre par câble USB.

## Sources

- Garmin, [Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/) (« only for business use », pas de frais) et [présentation du programme](https://developer.garmin.com/gc-developer-program/overview/) (« Stay tuned for more updates on the program »).
- Pause des demandes Garmin : [the5krunner, 14 septembre 2026](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/), [Terra, 7 septembre 2026](https://tryterra.co/blog/garmin-connect-developer-program-pause), [forum développeurs Garmin](https://forums.garmin.com/developer/connect-iq/f/discussion/434798/cannot-access-developer-program-application-form-under-construction/2027757).
- Suunto, [APIZone](https://apizone.suunto.com/) (conditions, étapes, examen hebdomadaire, gratuité) ; envoi des séances comme guides par un partenaire : [Tredict, Suunto structured workouts with guides](https://tredict.com/blog/suunto_structured_workouts_with_guides).
- MyWhoosh sans intégration directe : [enduco, MyWhoosh](https://knowledge.enduco.app/en/articles/12840740-mywhoosh).
- SuuntoPlus ouvert aux développeurs : [Suunto, Open SuuntoPlus (11 mars 2026)](https://www.suunto.com/mt-mt/sports/News-Articles-container-page/open-suuntoplus-built-by-the-community.-powered-by-suunto), [SuuntoPlus Editor](https://apizone.suunto.com/suuntoplusEditor) (« the Suunto app may remove your SuuntoPlus app from the watch »), [APIZone, FAQ](https://apizone.suunto.com/faq) (pas d'accès pour un usage personnel) ; applications effacées à la synchronisation : [forum Suunto](https://forum.suunto.com/topic/14783/question-no-stupid-questions-ask-anything-here?page=2) ; relais par une application de téléphone : [forum Suunto, Live location](https://forum.suunto.com/topic/11562/live-location-s-app/18).
- Garmin, enregistrement de séance impossible en tâche de fond : [forum développeurs Garmin](https://forums.garmin.com/developer/connect-iq/f/discussion/356255/can-you-use-persistedcontent-in-background).
- Zwift : voir [EXPORTS.md](EXPORTS.md).
