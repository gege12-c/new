# Exports de séances

Une séance prévue s'exporte depuis sa fiche (panneau de séance, rubrique « Exporter vers mes appareils »), côté athlète comme côté coach. Le code est dans `src/lib/export/` ; la conversion part toujours du format interne (`docs/WORKOUT_FORMAT.md`), jamais d'un autre export.

## Quatre cas, pour chaque fournisseur

| | Séance prévue vers l'appareil | Téléchargement manuel | Synchronisation automatique | Activité réalisée vers TriCoach |
| --- | --- | --- | --- | --- |
| Zwift | manuel : fichier .zwo à importer sur ordinateur (vélo seulement) | disponible (.zwo, vélo) | impossible : pas d'API publique d'envoi de séances | par Strava ou fichier FIT |
| Garmin | automatique par intervals.icu (calendrier Garmin Connect, puis la montre) ; sinon fichier FIT de séance copié par câble USB, ou application TriCoach sur la montre | disponible (FIT de type séance) | par intervals.icu ; API Training de Garmin fermée aux nouvelles demandes | par Strava ou fichier FIT |
| Wahoo | automatique par intervals.icu (compteurs ELEMNT, 7 prochains jours), vélo seulement dans l'application ; envoi direct : API Cloud sur demande et approbation | impossible : aucun import manuel documenté par Wahoo | par intervals.icu | par Strava ou fichier FIT |
| Suunto | automatique par intervals.icu (guide SuuntoPlus sur la montre) ; envoi direct prêt, en attente de l'accès partenaire | impossible : recopier la séance dans l'application Suunto (fiche « étapes Suunto » fournie) | par intervals.icu | par Strava ou fichier FIT |
| COROS | automatique par intervals.icu (calendrier COROS, puis la montre) | aucun fichier de séance importable documenté | par intervals.icu | par Strava ou fichier FIT |

Ces capacités sont des données (`src/lib/export/providers.ts`), affichées telles quelles dans l'application : rubrique d'export de chaque séance et panneau « Appareils et applications » du profil sportif.

**Rubrique d'export d'une séance** (31 octobre 2026) : « Sur la montre » (envoi automatique) en tête, pour toutes les disciplines ; les autres voies (fichier Garmin, appli Suunto, Zwift, Wahoo, fiche texte) sont regroupées sous « Autres façons d'exporter », repliée quand l'envoi automatique est en place, ouverte sinon. Zwift et Wahoo n'apparaissent que pour une séance (ou une partie) de vélo : décision de l'utilisateur, la course et la natation partent sur la montre. Le générateur .zwo sait toujours écrire la course sur tapis (testé), mais l'application ne la propose plus.

## Conditions officielles vérifiées (19 octobre 2026)

- **Zwift** : pas d'API publique pour envoyer des séances. L'import d'un fichier .zwo est documenté par Zwift : sur Mac, Documents > Zwift > Workouts > dossier au numéro Zwift ; sur PC, icône Z de la zone de notification > Open Logs Folder > Zwift > Workouts > dossier au numéro Zwift ; redémarrer Zwift ; un fichier de plus de 64 Ko reste sur l'ordinateur d'import. Source : [Zwift, Custom Workouts](https://support.zwift.com/en_us/custom-workouts-ryGOTVEPs).
- **Garmin** : l'API Training (Garmin Connect Developer Program) publie séances et plans dans le calendrier Garmin Connect ; accès après approbation par Garmin. Source : [Garmin, Training API](https://developer.garmin.com/gc-developer-program/training-api). Les nouvelles demandes sont suspendues depuis le printemps 2026, sans date de reprise (vérifié le 19 octobre 2026, voir [PARTNERS.md](PARTNERS.md)). Sans elle, le fichier FIT de séance se copie dans le dossier `GARMIN/NewFiles` de l'appareil, par câble USB ; méthode décrite par TrainingPeaks, partenaire de Garmin : [Structured Workout Export for Garmin Devices](https://help.trainingpeaks.com/hc/en-us/articles/115001076908-Structured-Workout-Export-for-Garmin-Devices). Garmin Connect (site et application) n'importe que des fichiers d'activité, pas de séance. En attendant l'API Training : l'application TriCoach pour montre Garmin (Connect IQ) télécharge ce même fichier FIT par le téléphone et l'enregistre en séance Garmin ([GARMIN_WATCH.md](GARMIN_WATCH.md)).
- **Wahoo** : l'API Cloud est ouverte « à ceux qui la demandent », après approbation ; application de production distincte de la sandbox ; portées `plans_read` et `plans_write` pour les séances planifiées. Source : [Wahoo, Cloud API](https://developers.wahooligan.com/cloud). Les compteurs ELEMNT ne reçoivent des séances planifiées que des partenaires agréés : [Wahoo, applications partenaires](https://support.wahoofitness.com/hc/en-us/articles/23022859474962). Aucun import manuel de fichier de séance n'y est documenté. Relais en place : intervals.icu envoie les 7 prochains jours de son calendrier au cloud Wahoo, puis au compteur, une fois Wahoo relié dans ses réglages et la case d'envoi des séances cochée (annonce du développeur d'intervals.icu, 2 mai 2024) : [intervals.icu, Upload planned workouts to Wahoo](https://forum.intervals.icu/t/upload-planned-workouts-to-wahoo/65949).
- **Suunto** : l'API est réservée aux entreprises et organisations proposant un service au public (pas d'accès personnel), examen hebdomadaire (deux semaines au plus), contrat API, gratuite ; la production exige une soumission de contenu. Source : [Suunto APIZone](https://apizone.suunto.com/). Les séances structurées y arrivent comme « guides SuuntoPlus ». Méthode manuelle officielle : le créateur de séances de l'application Suunto, synchronisé sur la montre comme guide : [Suunto, Plan your interval workouts](https://us.suunto.com/blogs/blog/plan-your-interval-workouts-with-suunto-app).

Envoi direct vers Garmin, Wahoo ou Suunto : hors V1 tant que l'accès n'est pas obtenu (cahier des charges). Les prérequis sont affichés dans l'application.

**Envoi automatique par intervals.icu** (depuis le 31 octobre 2026) : intervals.icu, partenaire officiel de Suunto, Garmin et COROS, qui envoie aussi les séances aux compteurs Wahoo, reçoit les séances publiées par son API ouverte et les transmet à la montre de l'athlète. Conversion, fenêtre, limites et sources : [WATCHES.md](WATCHES.md). Dans chaque séance, « Sur la montre » donne l'état de l'envoi et le contrôle de compatibilité, comme pour les fichiers.

## Déroulé d'un export

1. **Contrôle de compatibilité**, affiché avant tout téléchargement, pour chaque fournisseur et chaque discipline d'un enchaînement :
   - `blocking` : export impossible tel quel, avec la marche à suivre (bouton désactivé) ;
   - `loss` : information perdue ou approchée, dite précisément (« Plage 105–110 % ramenée à 107,5 % ») ;
   - `info` : conversion sans perte, signalée par transparence (zones converties, allure de référence…).
2. **Conversion** du segment demandé (un fichier par discipline pour un enchaînement).
3. **Relecture** du fichier produit : le .zwo est réanalysé (structure, attributs, durées) ; le FIT est décodé avec le SDK FIT officiel (intégrité CRC, type « séance », index, répétitions, durées, plages de cibles). Un fichier qui échoue n'est jamais servi.
4. **Historique** : chaque tentative, réussie ou non, est inscrite dans `workout_exports` (fournisseur, partie, version de la séance, empreinte SHA-256, écarts). La fiche signale un fichier téléchargé avant une modification de la séance.
5. **Relance** : après un échec (réseau, conversion), le message d'erreur s'affiche avec « Réessayer ».

Les seuils utilisés sont ceux de l'athlète en vigueur à la date de la séance (historisés), comme pour les durées estimées.

## Zwift (.zwo)

| Format interne | Fichier .zwo |
| --- | --- |
| Vélo | `sportType` bike, durées en secondes ; intensité = fraction de la FTP |
| Course | `sportType` run, `durationType` time, ou distance si toutes les étapes sont en distance ; intensité = fraction de l'allure de référence, attribut `pace="2"` (allure 10 km du profil Zwift) |
| % FTP | fraction directe (95 % → 0,95) |
| Zone de puissance | plage de % FTP du modèle de Coggan (info) |
| Watts | % FTP avec la FTP de l'athlète ; sans FTP : sortie libre (perte) |
| % allure seuil, zone d'allure | fraction directe de la vitesse au seuil |
| Allure /km, km/h | rapportées à l'allure seuil de l'athlète ; sans allure seuil, l'étape de travail est bloquée (marche à suivre affichée) |
| Plage de cible | Zwift vise une valeur : centre de la plage (perte) ; zone 1 (borne basse à 0) : haut de la plage |
| Échauffement, retour au calme avec une plage | rampe `Warmup` (bas → haut) ou `Cooldown` (haut → bas) |
| Répétition de deux étapes ciblées | un bloc `IntervalsT` ; sinon déroulée bloc par bloc |
| Étape sans cible | vélo : `FreeRide` ; course : 80 % de l'allure de référence pour une étape facile (perte), blocage pour une étape de travail |
| Transition (course) | retirée (info) |
| Étape libre (bouton tour) | 5 min ou 1 km (perte) |
| Distance dans une séance en durée | durée estimée d'après les seuils (perte), sinon blocage |
| FC, RPE, cadence de course | non suivies par Zwift : affichées en consigne à l'écran (perte) |
| Cadence vélo | attribut `Cadence` (centre de la plage) |
| Consignes, intitulé | `textevent` au début de l'étape (140 caractères) |
| Limites | 250 blocs au plus (blocage) ; au-delà de 64 Ko, pas de synchronisation entre appareils (perte) |

Natation, renforcement et « autre » : non pris en charge par Zwift (blocage).

## Garmin (FIT de séance)

Écrit avec le SDK FIT officiel (`@garmin/fitsdk`) : `file_id` (type `workout`, fabricant `development`), `workout` (nom, sport, nombre d'étapes, description), puis une `workout_step` par étape. Le SDK n'écrivant pas les sous-champs, les champs principaux reçoivent leurs valeurs brutes, puis le fichier est relu avec expansion des sous-champs.

| Format interne | Fichier FIT |
| --- | --- |
| Discipline | vélo `cycling` ; course `running` ; natation `swimming` / `lapSwimming` ; renforcement `training` / `strengthTraining` ; autre `generic` |
| Durée, distance | `time` (ms), `distance` (cm) ; répétitions `reps` ; étape libre `open` (bouton tour) |
| Type d'étape | échauffement `warmup`, travail et éducatifs `active`, récupération `recovery`, repos `rest`, retour au calme `cooldown`, transition `other` |
| % FTP | puissance, plage personnalisée 0–1000 = % FTP (l'appareil applique sa propre FTP, info) |
| Watts | puissance, valeur + 1000 |
| Zone de puissance | plage de % FTP du modèle de Coggan (info) |
| FC en bpm | valeur + 100 ; % FC max : 0–100 |
| % FC seuil, zone de FC | convertis en bpm avec la FC seuil (info) ; sans FC seuil : zone de l'appareil si une seule zone, sinon perte |
| Allure, vitesse | vitesse en mm/s ; allures relatives converties avec l'allure seuil ou la CSS, sinon perte |
| Cadence vélo | cadence (tr/min) |
| Deuxième cible | cible secondaire (tous les appareils ne l'affichent pas, info) |
| RPE, cadence de course | pas d'équivalent fiable : notes de l'étape (perte) |
| Matériel de natation | champ `equipment` (un seul) ; le reste dans les notes (perte) |
| Départ (send-off) | notes de l'étape (perte) |
| Répétition | étape `repeatUntilStepsCmplt` renvoyant à la première étape répétée ; répétitions imbriquées déroulées dans la répétition qui les contient (info) |
| Textes | limités par le format : nom 60 octets, intitulé 50, notes et description 250 (perte si raccourcis) |
| Natation en piscine | la longueur du bassin se règle sur la montre (info) |

Au-delà de 50 étapes, l'application prévient que certains appareils peuvent refuser la séance.

## Fiche texte

Pour les applications sans import de fichier (Suunto, Wahoo), la fiche reprend chaque étape avec ses cibles, suivies de leur valeur absolue quand les seuils le permettent (« 238–250 W (95–100 % FTP) »), à copier en un clic.

### Fiche « étapes Suunto »

La séance écrite comme le créateur d'entraînements structurés de l'application Suunto la demande (`src/lib/export/suunto-steps.ts`), rubrique « Recopier dans l'appli Suunto » de chaque séance : nom et description à copier (la description s'affiche sur la montre), mode sportif, date (la montre propose alors la séance ce jour-là), puis les étapes dans l'ordre de saisie, à cocher au fur et à mesure.

| TriCoach | Suunto |
| --- | --- |
| échauffement | « échauffement » |
| travail, éducatifs | « intervalle » (éducatifs nommés comme tels) |
| récupération, repos, transition | « récupération » (repos et transition nommés comme tels) |
| retour au calme | « retour au calme » |
| durée, distance | fin en durée, en distance |
| durée libre, répétitions de renforcement | fin au bouton tour (nombre de répétitions noté à côté) |
| puissance, % FTP, zones de puissance | objectif de puissance en W (FTP à la date de la séance) |
| FC, % FC seuil, % FC max, zones cardiaques | objectif de fréquence cardiaque en bpm |
| allure, % de l'allure seuil ou de la CSS, zones d'allure | objectif d'allure en min:s par km (course) ou par 100 m (natation) |
| vitesse | objectif de vitesse en km/h |
| cadence, effort ressenti, matériel, départs, consignes, seconde cible | écrits sous l'étape : Suunto ne les porte pas |
| répétition dans une répétition | déroulée, pour un seul niveau de répétition |
| enchaînement | un entraînement Suunto par partie |

Un seuil manquant n'est jamais deviné : l'objectif reste vide, la cible prévue est écrite sous l'étape et le seuil à renseigner est signalé une fois. Source des champs : [Suunto, créer un entraînement structuré](https://www.suunto.com/fr-ch/Assistance/faq-articles/suunto-app/how-can-i-create-structured-workouts-with-suunto-app/) et [Suunto, Plan your interval workouts](https://us.suunto.com/blogs/blog/plan-your-interval-workouts-with-suunto-app) (fins en durée, distance ou bouton tour ; objectifs de fréquence cardiaque, puissance, allure ou vitesse).

## Tests

- `src/lib/export/export.test.ts` : une même séance donne un .zwo et un FIT valides et de même durée ; rampes, intervalles, zones, watts sans FTP, course en durée et en distance, blocages, natation, FC, répétitions imbriquées, textes trop longs, fichier abîmé, enchaînement, fiche texte.
- `tests/db/exports.test.ts` : historique sous RLS (l'athlète et ses coachs ; un coach non autorisé ne lit ni n'ajoute rien ; brouillon invisible de l'athlète ; ni modification ni suppression ; cohérence des lignes).
- `e2e/exports.spec.ts` : dans un navigateur, l'athlète voit le contrôle de compatibilité, télécharge le .zwo et le FIT d'un enchaînement (fichiers relus, FIT décodé avec le SDK) ; le coach voit l'historique ; l'API refuse les demandes anonymes, invalides ou inaccessibles.
- Contrôle croisé (manuel, 19 octobre 2026) : les FIT produits ont aussi été relus par un décodeur indépendant (`fitdecode`, Python), CRC vérifié, valeurs identiques.
