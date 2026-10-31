# Séances sur la montre

Une séance publiée dans TriCoach part seule vers la montre de l'athlète : l'écran de chaque étape, sa cible, son compte à rebours. Elle est mise à jour quand le coach la modifie ou que les seuils changent, et retirée quand elle est annulée, supprimée, repassée en brouillon ou déplacée hors de la fenêtre d'envoi.

Deux voies, chacune reliée par l'athlète dans son profil sportif (rubrique « Séances sur la montre ») :

| Voie | Montres | État | Fenêtre |
| --- | --- | --- | --- |
| Par intervals.icu | Suunto, Garmin, COROS | disponible | séances publiées d'aujourd'hui à J+13, déposées dans le calendrier intervals.icu ; intervals.icu transmet la semaine à venir à la montre |
| Suunto en direct | Suunto | prête, en attente de l'accès partenaire de Suunto | séances publiées d'aujourd'hui à J+6, envoyées comme guides SuuntoPlus |

Une seule voie par montre : une Suunto reliée à la fois à intervals.icu et à Suunto en direct recevrait chaque séance deux fois.

## Pourquoi intervals.icu

Seuls les partenaires agréés d'une marque peuvent déposer une séance sur ses montres ; une application de téléphone ou un fichier ne le permettent pas (voir [PARTNERS.md](PARTNERS.md)). intervals.icu est partenaire officiel de Suunto (guides SuuntoPlus, depuis mars 2022), de Garmin (calendrier Garmin Connect) et de COROS (depuis avril 2023), et son API officielle permet à une application de déposer des séances prévues dans le calendrier d'un athlète. Ses conditions d'utilisation de l'API (en vigueur au 23 octobre 2025) autorisent tout usage légal, y compris commercial ; gratuit pour l'athlète.

TriCoach reste l'endroit où tout se fait : l'athlète n'utilise pas intervals.icu, qui sert seulement de relais.

## Mise en route (athlète, une fois)

1. Créer un compte gratuit sur intervals.icu.
2. Dans ses réglages (Settings), relier sa montre : Suunto, Garmin ou COROS, et cocher l'envoi des séances prévues (« Upload planned workouts »).
3. Toujours dans Settings, en bas, « Developer Settings » : copier la clé API, puis la coller dans TriCoach, Profil sportif, « Séances sur la montre ». TriCoach la vérifie auprès d'intervals.icu, puis la garde chiffrée sur le serveur (AES-256-GCM, comme les jetons Strava) ; elle n'est plus jamais affichée.

Délier intervals.icu retire de son calendrier les séances à venir déposées par TriCoach et efface la clé. Une clé changée ou supprimée chez intervals.icu est détectée au passage suivant : l'athlète est prévenu (notification « reconnexion ») et colle sa nouvelle clé.

## Ce que reçoit la montre

TriCoach écrit chaque séance dans le format texte de l'éditeur d'intervals.icu (guide officiel « Workout Builder Syntax ») : une ligne par étape, les répétitions entre deux lignes vides, une séance par discipline pour un enchaînement.

- Cibles en valeurs absolues quand les seuils de TriCoach le permettent : puissance en watts (« 238-250w »), allure (« 4:30/km-4:40/km Pace », « 1:38/100m-1:42/100m Pace »), cadence de pédalage (« 85-95rpm »). La montre reçoit ainsi exactement les valeurs de TriCoach, sans dépendre des réglages d'intervals.icu.
- Sans seuil dans TriCoach, la cible reste relative (« 55-70% » de FTP, « % Pace », zones) : intervals.icu la calcule avec ses propres réglages, et la fiche de la séance le dit.
- Fréquence cardiaque : intervals.icu ne lit que des pourcentages (du seuil, de la FC max) ou des zones ; une cible en bpm est convertie avec la FC seuil (ou la FC max) de TriCoach. Gardez les mêmes valeurs dans intervals.icu.
- Écrits dans la description de la séance, pas sur les étapes : effort ressenti, cadence de course, départs de natation, matériel, consignes ; un intitulé contenant des chiffres (intervals.icu le lirait comme une durée).
- Impossibles à transmettre, et dits comme tels : étapes à durée libre (bouton tour) et répétitions de renforcement, absentes du format ; la séance n'est pas déposée et la raison s'affiche.

Dans chaque fiche de séance, rubrique « Exporter vers mes appareils », « Sur la montre » : où en est l'envoi (déposée le…, mise à jour en cours, partira le…, non envoyée et pourquoi) et le contrôle de ce que la montre suivra.

## Suunto en direct (dès l'accès partenaire)

TriCoach construit lui-même le guide SuuntoPlus (format « sequence » de l'API Guides de Suunto) : par étape, la cible et sa valeur en direct, le compte à rebours, la fréquence cardiaque et une consigne ; un tour au début de chaque étape ; une étape « Fin » avec le temps total. Archive zip (manifest.json, guide.json, icône 300 × 300) contrôlée avant chaque envoi. À l'activation : variables `SUUNTO_CLIENT_ID`, `SUUNTO_CLIENT_SECRET`, `SUUNTO_SUBSCRIPTION_KEY` et `SUUNTO_APP_NAME` (nom exact de l'application chez Suunto) dans Vercel, adresse de retour `https://<site>/api/suunto/callback` déclarée chez Suunto ; facultatif : `SUUNTO_ACTIVITIES` (« run:1,bike:2 », modes sportifs Suunto proposant le guide).

## Fonctionnement

- Base : table `device_workouts` (une ligne par séance et par discipline envoyée : identifiant chez le fournisseur, version et empreinte envoyées, état, raison d'un échec), lisible par l'athlète et ses coachs, écrite par le serveur seul ([SCHEMA.md](SCHEMA.md)).
- Chaque changement d'une séance publiée ou des seuils met un envoi en file (déclencheurs de la base), pour chaque compte relié actif ; l'envoi part aussitôt après l'action du coach, et la tâche quotidienne fait avancer la fenêtre d'un jour.
- Un envoi est un rapprochement idempotent : identifiant externe `tricoach-<séance>-<partie>`, renvoi seulement si la séance ou les seuils ont changé, retrait de ce qui n'est plus prévu. Un seul envoi à la fois par compte (bail en base) ; quota du fournisseur : envoi reporté sans compter d'échec.
- Code : `src/lib/intervals/` (client, conversion, envois), `src/lib/suunto/` (client OAuth et guides, conversion, archive, envois), `src/lib/devices/` (file commune).

## Limites

- Pas d'essai sur le vrai intervals.icu depuis l'environnement de développement (il ne joint que GitHub et les registres de paquets) : tout est testé contre un faux intervals.icu qui applique le format documenté (tests d'intégration et parcours de bout en bout). Le premier essai réel se fait avec votre clé.
- Une clé API personnelle convient pour vous ; pour accueillir d'autres athlètes, intervals.icu recommande une application OAuth (à enregistrer chez intervals.icu, dans Settings, « Apps ») : à faire avant d'ouvrir le relais à d'autres.

## Sources

- [intervals.icu : accès à l'API (clé personnelle, authentification, quotas)](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)
- [intervals.icu : dépôt des séances prévues par l'API (lot, identifiant externe, retrait)](https://forum.intervals.icu/t/uploading-planned-workouts-to-intervals-icu/63624)
- [intervals.icu : format texte des séances](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701)
- [intervals.icu : conditions d'utilisation de l'API](https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087)
- [intervals.icu : envoi vers les montres Suunto](https://forum.intervals.icu/t/upload-workouts-to-suunto-watches/9560)
- [intervals.icu : envoi vers Garmin Connect](https://forum.intervals.icu/t/upload-planned-workouts-to-garmin-connect/1521)
- [intervals.icu : COROS](https://forum.intervals.icu/t/coros-support-added/37006)
- [Suunto : programme API (APIZone)](https://apizone.suunto.com/)
