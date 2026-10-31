# Séances sur la montre

Une séance publiée dans TriCoach part seule vers la montre de l'athlète : l'écran de chaque étape, sa cible, son compte à rebours. Elle est mise à jour quand le coach la modifie ou que les seuils changent, et retirée quand elle est annulée, supprimée, repassée en brouillon ou déplacée hors de la fenêtre d'envoi.

Deux voies, chacune reliée par l'athlète dans son profil sportif (rubrique « Séances sur la montre ») :

| Voie | Montres | État | Fenêtre |
| --- | --- | --- | --- |
| Par intervals.icu | Suunto, Garmin, COROS, compteurs Wahoo | disponible | séances publiées d'aujourd'hui à J+13, déposées dans le calendrier intervals.icu ; intervals.icu transmet la semaine à venir à la montre |
| Suunto en direct | Suunto | prête, en attente de l'accès partenaire de Suunto | séances publiées d'aujourd'hui à J+6, envoyées comme guides SuuntoPlus |

Une seule voie par montre : une Suunto reliée à la fois à intervals.icu et à Suunto en direct recevrait chaque séance deux fois.

## Pourquoi intervals.icu

Seuls les partenaires agréés d'une marque peuvent déposer une séance sur ses montres ; une application de téléphone ou un fichier ne le permettent pas (voir [PARTNERS.md](PARTNERS.md)). intervals.icu est partenaire officiel de Suunto (guides SuuntoPlus, depuis mars 2022), de Garmin (calendrier Garmin Connect) et de COROS (depuis avril 2023), et son API officielle permet à une application de déposer des séances prévues dans le calendrier d'un athlète. Ses conditions d'utilisation de l'API (en vigueur au 23 octobre 2025) autorisent tout usage légal, y compris commercial ; gratuit pour l'athlète.

TriCoach reste l'endroit où tout se fait : l'athlète n'utilise pas intervals.icu, qui sert seulement de relais.

## Mise en route (athlète, une fois)

1. Créer un compte gratuit sur intervals.icu.
2. Dans ses réglages (Settings), relier sa montre : Suunto, Garmin ou COROS, et cocher l'envoi des séances prévues (« Upload planned workouts ») ; pour un compteur Wahoo ELEMNT, relier Wahoo et cocher « Upload workouts » (les 7 prochains jours).
3. Toujours dans Settings, en bas, « Developer Settings » : copier la clé API, puis la coller dans TriCoach, Profil sportif, « Séances sur la montre ». TriCoach la vérifie auprès d'intervals.icu, puis la garde chiffrée sur le serveur (AES-256-GCM, comme les jetons Strava) ; elle n'est plus jamais affichée.

Délier intervals.icu retire de son calendrier les séances à venir déposées par TriCoach et efface la clé. Une clé changée ou supprimée chez intervals.icu est détectée au passage suivant : l'athlète est prévenu (notification « reconnexion ») et colle sa nouvelle clé.

## Ce que reçoit la montre

TriCoach écrit chaque séance dans le format texte de l'éditeur d'intervals.icu (guide officiel « Workout Builder Syntax ») : une ligne par étape, les répétitions entre deux lignes vides, une séance par discipline pour un enchaînement.

- Cibles en valeurs absolues quand les seuils de TriCoach le permettent : puissance en watts (« 238-250w »), allure (« 4:30/km-4:40/km Pace », « 1:38/100m-1:42/100m Pace »), cadence de pédalage (« 85-95rpm »). La montre reçoit ainsi exactement les valeurs de TriCoach, sans dépendre des réglages d'intervals.icu.
- Sans seuil dans TriCoach, la cible reste relative (« 55-70% » de FTP, « % Pace », zones) : intervals.icu la calcule avec ses propres réglages, et la fiche de la séance le dit.
- Fréquence cardiaque : intervals.icu ne lit que des pourcentages (du seuil, de la FC max) ou des zones ; une cible en bpm est convertie avec la FC seuil (ou la FC max) de TriCoach. Gardez les mêmes valeurs dans intervals.icu.
- Un seul type de cible par séance : intervals.icu n'en trace qu'un dans son graphique (les autres étapes y paraissent grises). Une course qui mêle FC et allure part donc tout en allure, une sortie vélo qui mêle FC et puissance tout en puissance : chaque étape en FC est convertie par équivalence des zones théoriques (zone 2 de FC → zone 2 d'allure ; une plage en % de la FC seuil ou en bpm tombe au même endroit des zones d'allure ou de puissance, `src/lib/workout/equivalence.ts`), et la FC visée reste écrite dans les consignes de l'étape (« FC visée Z1 (90–151 bpm) »). Les étapes d'au moins 2 minutes en allure ou en puissance de ces séances reçoivent aussi la FC qui leur correspond (« FC indicative ») ; en dessous, la FC n'a pas le temps de suivre. Une FC en bpm sans FC seuil n'est pas convertie au jugé : elle part telle quelle et la fiche explique le graphique gris.
- Écrits dans la description de la séance, pas sur les étapes : effort ressenti, cadence de course, départs de natation, matériel, consignes ; un intitulé contenant des chiffres (intervals.icu le lirait comme une durée).
- Impossibles à transmettre, et dits comme tels : étapes à durée libre (bouton tour) et répétitions de renforcement, absentes du format ; la séance n'est pas déposée et la raison s'affiche.

Dans chaque fiche de séance, rubrique « Exporter vers mes appareils », « Sur la montre » : où en est l'envoi (déposée le…, mise à jour en cours, partira le…, non envoyée et pourquoi) et le contrôle de ce que la montre suivra.

## Retour des activités faites

Le même lien sert dans l'autre sens : les activités qu'intervals.icu reçoit de la montre (Suunto, Garmin, COROS) reviennent dans TriCoach, sans import de fichier. API officielle : liste des activités d'une période (`GET /api/v1/athlete/0/activities?oldest=…&newest=…`, résumés : durées, distance, dénivelé, fréquence cardiaque, puissance, cadence, vitesse).

- Première réception : la dernière année (de quoi nourrir la courbe de condition, une fois aussi pour un compte relié avant le 31 octobre) ; ensuite, les 14 derniers jours à chaque passage. Chaque activité arrive avec la charge qu'intervals.icu lui a calculée (`icu_training_load`), reprise telle quelle par la courbe de condition, pour qu'elle concorde avec celle d'intervals.icu. Une activité modifiée chez intervals.icu l'est aussi ici ; une activité supprimée chez intervals.icu dans ces 14 jours l'est aussi ici (au-delà, elle reste).
- Quand : à chaque envoi de séances, à l'ouverture de l'accueil ou du calendrier (au plus toutes les 10 minutes), par la tâche quotidienne et par « Envoyer maintenant ». Ce qui arrive s'affiche en direct.
- Rattachées aux séances prévues comme les autres activités, visibles des coachs que l'athlète autorise à voir ses activités, comptées dans la progression et la courbe de condition (ce sont les données de l'athlète, pas celles de Strava).
- Celles qu'intervals.icu reçoit de Strava ne sont jamais transmises par son API (règles de Strava) : TriCoach les compte et le dit dans le profil, sans rien deviner. Il suffit de relier la montre directement à intervals.icu.
- Une même séance faite arrivée par plusieurs chemins (Strava, intervals.icu, fichier FIT) n'est comptée qu'une fois : même discipline, départ à 5 minutes près, durée à 20 % près. L'original est l'activité de la montre ou du fichier ; la copie Strava reste en doublon caché, et une décision prise sur elle (rattachement, séance écartée) passe à l'original.
- Pour corriger ou retirer une activité reçue : chez intervals.icu (lien « Voir sur intervals.icu » dans l'activité).
- Mesures du matin : FC au repos, VFC, durée du sommeil et poids qu'intervals.icu reçoit de la montre ou d'une balance (`GET /api/v1/athlete/0/wellness`, 14 derniers jours) complètent la forme du jour de l'athlète, champ par champ, sans jamais remplacer une valeur qu'il a saisie.
- Courbes et intervalles : pour chaque activité reçue, TriCoach lit ses courbes (`GET /api/v1/activity/{id}/streams.json?types=time,watts,heartrate,cadence,velocity_smooth,altitude,distance`, sans la trace GPS) et les intervalles qu'intervals.icu y a détectés (`GET /api/v1/activity/{id}/intervals`), une seule fois ; il les relit si l'activité change chez intervals.icu (souvent : son analyse vient de se terminer). Huit activités au plus par passage, les plus récentes d'abord : à la première réception, l'historique de 90 jours se complète au fil des passages. Un quota atteint arrête la lecture, reprise au passage suivant. Format : spécification OpenAPI d'intervals.icu (`ActivityStream` : `{ type, data }` ; `IntervalsDTO` : `icu_intervals`).
- Dans TriCoach : la fiche de l'activité (et la séance à laquelle elle est rattachée) montre ses courbes (puissance, fréquence cardiaque, vitesse ou allure, cadence à vélo, altitude) sur le même axe du temps, les efforts détectés en fond, la lecture des valeurs au doigt, à la souris ou au clavier, le tableau des intervalles et les meilleures puissances de la séance (5 s, 1, 5, 20 et 60 min). Dans la séance, « Prévu et réalisé, étape par étape » retrouve chaque étape prévue sur les courbes : elle commence où la précédente finit, dure le temps (ou la distance) prévu, et chaque changement d'intensité est recalé là où l'allure (tirée de la distance GPS) ou la puissance change le plus nettement ; ses mesures sont calculées sur les courbes (cible tenue, au-dessus, en dessous, à 2 % près, 5 % pour une étape de moins d'une minute). C'est indépendant des intervalles d'intervals.icu, qui peuvent mêler tours au kilomètre et étapes, se chevaucher et en manquer (vu le 31 octobre : deux accélérations sur cinq absentes). Une activité qui ne suit visiblement pas la séance, ou sans courbe, retombe sur les tours, dans l'ordre. Les intervalles qui se chevauchent sont nettoyés à la réception comme à la lecture. La page Progression en tire les meilleures puissances sur 6 semaines, 3 mois et 12 mois. Les fichiers FIT importés donnent la même chose (courbes lues dans le navigateur, tours enregistrés par la montre).

## Mêmes seuils des deux côtés

intervals.icu calcule avec ses propres seuils ce que TriCoach lui laisse calculer : cibles de FC en % du seuil ou en zones, charge d'entraînement, forme. Dans Profil sportif, « Séances sur la montre », une fois intervals.icu relié, « Comparer avec intervals.icu » lit ses réglages par sport (`GET /api/v1/athlete/0/sport-settings`, sans rien changer) et les met à côté de ceux de TriCoach : FTP, FC seuil et FC max à vélo ; allure seuil, FC seuil et FC max en course ; CSS en natation.

- **TriCoach fait référence** : « Envoyer mes seuils à intervals.icu » n'envoie que les valeurs différentes (`PUT /api/v1/athlete/0/sport-settings/{id}`, seulement les champs changés, convention de l'API d'intervals.icu ; allure seuil et CSS en mètres par seconde, unité de stockage d'intervals.icu, `pace_units` ne réglant que l'affichage). Quand une FC change, `recalcHrZones=true` : intervals.icu recalcule ses zones de FC. Rien n'y est effacé : un seuil absent de TriCoach ne part pas. La réponse est relue ; si intervals.icu remplaçait tout le réglage au lieu des seuls champs envoyés, le réglage complet lu juste avant est renvoyé avec les nouvelles valeurs.
- **Reprendre** une valeur d'intervals.icu l'enregistre dans TriCoach à la date du jour (historique gardé), puis les séances à venir repartent avec.
- Code : `src/lib/intervals/thresholds.ts` (correspondances et écarts), `compareIntervalsThresholds` et `alignIntervalsThresholds` (`src/lib/intervals/service.ts`) ; tests : `src/lib/intervals/thresholds.test.ts`, `tests/integration/intervals-thresholds.test.ts`, `e2e/watch-sync.spec.ts`.
- Sources : spécification OpenAPI d'intervals.icu (SportSettings) ; unité de `threshold_pace` : [intervals.icu, Run threshold_pace units](https://forum.intervals.icu/t/not-a-bug-run-threshold-pace-units/123710) ; mise à jour par les seuls champs envoyés : [Integration Cookbook](https://forum.intervals.icu/t/intervals-icu-integration-cookbook/80090).

## Suunto en direct (dès l'accès partenaire)

TriCoach construit lui-même le guide SuuntoPlus (format « sequence » de l'API Guides de Suunto) : par étape, la cible et sa valeur en direct, le compte à rebours, la fréquence cardiaque et une consigne ; un tour au début de chaque étape ; une étape « Fin » avec le temps total. Archive zip (manifest.json, guide.json, icône 300 × 300) contrôlée avant chaque envoi. À l'activation : variables `SUUNTO_CLIENT_ID`, `SUUNTO_CLIENT_SECRET`, `SUUNTO_SUBSCRIPTION_KEY` et `SUUNTO_APP_NAME` (nom exact de l'application chez Suunto) dans Vercel, adresse de retour `https://<site>/api/suunto/callback` déclarée chez Suunto ; facultatif : `SUUNTO_ACTIVITIES` (« run:1,bike:2 », modes sportifs Suunto proposant le guide).

## Fonctionnement

- Base : table `device_workouts` (une ligne par séance et par discipline envoyée : identifiant chez le fournisseur, version et empreinte envoyées, état, raison d'un échec), lisible par l'athlète et ses coachs, écrite par le serveur seul ([SCHEMA.md](SCHEMA.md)).
- Chaque changement d'une séance publiée ou des seuils met un envoi en file (déclencheurs de la base), pour chaque compte relié actif ; l'envoi part aussitôt après l'action du coach, et la tâche quotidienne fait avancer la fenêtre d'un jour.
- Un envoi est un rapprochement idempotent : identifiant externe `tricoach-<séance>-<partie>`, renvoi seulement si la séance ou les seuils ont changé, retrait de ce qui n'est plus prévu. Un seul envoi à la fois par compte (bail en base) ; quota du fournisseur : envoi reporté sans compter d'échec.
- Code : `src/lib/intervals/` (client, conversion des séances, activités reçues, envois), `src/lib/suunto/` (client OAuth et guides, conversion, archive, envois), `src/lib/devices/` (file commune) ; `POST /api/devices/refresh` (relecture à l'ouverture d'une page).

## Limites

- Pas d'essai sur le vrai intervals.icu depuis l'environnement de développement (il ne joint que GitHub et les registres de paquets) : tout est testé contre un faux intervals.icu qui applique le format documenté (tests d'intégration et parcours de bout en bout). Le premier essai réel se fait avec votre clé.
- Une clé API personnelle convient pour vous ; pour accueillir d'autres athlètes, intervals.icu recommande une application OAuth (à enregistrer chez intervals.icu, dans Settings, « Apps ») : à faire avant d'ouvrir le relais à d'autres.

## Sources

- [intervals.icu : accès à l'API (clé personnelle, authentification, quotas)](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)
- [intervals.icu : dépôt des séances prévues par l'API (lot, identifiant externe, retrait)](https://forum.intervals.icu/t/uploading-planned-workouts-to-intervals-icu/63624)
- [intervals.icu : format texte des séances](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701)
- [intervals.icu : conditions d'utilisation de l'API](https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087)
- [intervals.icu : recueil d'intégration de l'API (activités d'une période, fichiers, données de forme)](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090)
- [intervals.icu : envoi vers les montres Suunto](https://forum.intervals.icu/t/upload-workouts-to-suunto-watches/9560)
- [intervals.icu : envoi vers Garmin Connect](https://forum.intervals.icu/t/upload-planned-workouts-to-garmin-connect/1521)
- [intervals.icu : COROS](https://forum.intervals.icu/t/coros-support-added/37006)
- [intervals.icu : envoi des séances prévues vers Wahoo (2 mai 2024)](https://forum.intervals.icu/t/upload-planned-workouts-to-wahoo/65949)
- [Suunto : programme API (APIZone)](https://apizone.suunto.com/)
