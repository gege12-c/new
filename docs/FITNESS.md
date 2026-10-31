# Condition physique, fatigue et forme

Page « Progression » (athlète, et onglet de la fiche athlète côté coach), bloc « Condition physique ». Demandé le 19 octobre 2026 (initialement hors V1, « CTL/ATL/TSB avec méthode documentée ») ; code : `src/lib/stats/fitness.ts`, données : `src/lib/data/fitness.ts`.

## Modèle

Modèle impulsion-réponse de Banister, dans la forme popularisée par TrainingPeaks (CTL, ATL, TSB) et reprise par Intervals.icu :

- **charge** d'un jour : somme des charges de ses séances, en points de TSS (une heure au seuil = 100) ;
- **condition** (CTL) : `condition(j) = condition(j−1) + (charge(j) − condition(j−1)) / 42` ;
- **fatigue** (ATL) : la même chose sur 7 jours ;
- **forme** (TSB) : `condition(j) − fatigue(j)`, le même jour (comme Intervals.icu).

Le calcul part de zéro 120 jours avant la fenêtre affichée (13 semaines passées), pour que la condition affichée n'y parte pas de zéro. Avec moins de 42 jours d'historique réel, l'écran indique que la condition est encore sous-estimée. Quand la montre est reliée par intervals.icu, un an d'activités est reçu une fois (puis les 14 derniers jours à chaque passage) : sans lui, la condition de juillet d'un athlète très chargé manquait à celle d'octobre.

## Charge d'une séance

`charge = heures × intensité² × 100`, l'intensité étant le rapport au seuil, bornée entre 0,3 et 1,5 (un capteur aberrant ne fait pas exploser la courbe). Natation : intensité au cube, comme le sTSS.

| Source | Intensité | Qualité |
| --- | --- | --- |
| Activité reçue d'intervals.icu | charge calculée par intervals.icu (`icu_training_load`, avec ses propres seuils), reprise telle quelle : la courbe de TriCoach concorde avec la sienne | celle d'intervals.icu |
| Activité (montre ou fichier FIT), vélo | puissance normalisée / FTP : celle de la source, sinon celle tirée de la courbe ; à défaut, puissance moyenne / FTP | exacte (estimée sans puissance normalisée) |
| Activité, course, avec sa courbe | vitesse normalisée ajustée à la pente / vitesse au seuil | mesurée seconde par seconde |
| Activité, course, sans courbe | vitesse moyenne / vitesse au seuil (allure seuil) | estimée |
| Activité, natation | vitesse moyenne / CSS | estimée |
| Activité, autres cas | FC quadratique moyenne de la courbe (à défaut, FC moyenne) rapportée à la FC seuil (vélo ou course) ; avec la FC de repos, sur la réserve cardiaque : (FC − repos) / (seuil − repos) | estimée (approximation du hrTSS) |
| Fichier FIT sans mesure exploitable | ressenti (RPE) donné pour la séance rattachée, sur la durée du fichier | estimée ; sinon non comptée |
| Retour de séance « faite » sans fichier FIT | ressenti (RPE) sur la durée prévue ; sans ressenti, la charge prévue de la séance | estimée |
| Retour « en partie » | non comptée : la part faite n'est pas connue | — |
| Séance prévue (prévision) | étape par étape : % FTP, % seuil, zones, RPE, ou valeurs absolues rapportées aux seuils du jour | estimée ; une étape sans intensité exprimable n'est pas comptée (l'écran le dit) |

### Mesures tirées des courbes

Quand l'activité arrive avec sa courbe (montre reliée par intervals.icu, fichier FIT), trois mesures sont calculées une fois, seconde par seconde, avant la réduction de la courbe pour l'affichage, et gardées avec elle (`activity_streams.metrics`). Elles ne dépendent pas des seuils : la charge est recalculée à chaque affichage avec les seuils en vigueur à la date de l'activité. Dix minutes de mesures au moins ; sinon la moyenne sert.

- **Puissance normalisée** (méthode de Coggan) : moyenne glissante sur 30 s, élevée à la puissance 4, moyennée, racine 4e. Un fractionné pèse ce qu'il coûte, là où la moyenne l'écrase.
- **Vitesse normalisée ajustée à la pente** (course) : chaque seconde, la vitesse est corrigée par le coût énergétique de la pente, mesurée sur 30 s (au moins 20 m parcourus) et bornée à ±35 % : `C(i) = 155,4 i⁵ − 30,4 i⁴ − 43,3 i³ + 46,3 i² + 19,5 i + 3,6` J/kg/m (Minetti et al., 2002), rapporté au plat (3,6). Les arrêts (moins de 0,3 m/s) sont écartés. Puis la même normalisation que la puissance. Une côte compte ce qu'elle coûte, une descente moins.
- **FC quadratique moyenne** : racine de la moyenne des carrés ; elle donne le même résultat que la somme, seconde par seconde, de (FC / FC seuil)², c'est-à-dire la charge des passages intenses, que la FC moyenne sous-estime.

RPE en intensité : 1 → 45 %, 2 → 52 %, 3 → 62 %, 4 → 70 %, 5 → 80 %, 6 → 87 %, 7 → 95 %, 8 → 102 %, 9 → 113 %, 10 → 125 % du seuil (interpolé), calé sur les zones (RPE 7–8 = seuil). Les seuils utilisés sont ceux en vigueur à la date de chaque séance.

**FC de repos** : celle du profil sportif, sinon la médiane des 60 derniers jours de la forme du jour (souvent transmise par la montre), trois jours renseignés au moins. Sur la réserve cardiaque, une FC proche du repos pèse peu, comme dans le TRIMP de Banister et le HRSS d'Intervals.icu : une marche à 90 bpm compte 9 à 11 points par heure au lieu de 25 (Intervals.icu : 9 pour 47 minutes à 92 bpm).

**Seuils saisis après les activités** : un seuil n'est en vigueur qu'à partir de sa date ; pour une activité plus ancienne, sa première valeur sert, en estimation, et l'écran compte ces activités (« antérieures à vos seuils »). C'est ce que fait Intervals.icu en important un historique. Sans cela, un athlète qui saisit ses seuils après avoir relié sa montre voyait une condition presque nulle et une forme qui plongeait dès qu'il s'entraînait.

**Même séance enregistrée par deux appareils** (la montre et le compteur du vélo, tous deux transmis) : même discipline, enregistrements qui se recouvrent sur la moitié au moins du plus court. Seul le plus riche en mesures compte (puissance normalisée, puis puissance, allure ajustée, vitesse, FC, puis la durée) ; la séance rattachée au double reste « faite d'après un fichier ».

Une séance rattachée à un fichier FIT n'est comptée qu'une fois (par le fichier). Aujourd'hui : ce qui est fait, plus ce qui reste prévu ; à partir de demain : les séances publiées (les brouillons ne comptent pas, sauf dans une simulation).

## Prévision et simulation

- **Horizon** : la dernière séance prévue (brouillons compris) ou la prochaine course (objectif A d'abord, sinon la première course à venir), une semaine au moins, six mois au plus. Après la dernière séance comptée, la prévision suppose le repos : la courbe continue en pointillés fins, marquée « Sans séance prévue ».
- **Simulation** (athlète et coach) : chaque séance prévue peut être retirée du calcul (case à décocher, dans le détail d'un jour ou dans la liste par semaine), et les brouillons à venir ajoutés ; la courbe est recalculée aussitôt, dans le navigateur, sans rien changer au calendrier. « Revenir au plan publié » annule tout.
- **Courses** : marquées sur la courbe (A, B, C) ; pour chaque course à venir, la forme prévue au départ, c'est-à-dire celle de la veille au soir (la charge de la course elle-même n'y entre pas).
- **Détail d'un jour** : le jour pointé (aujourd'hui par défaut) donne condition, fatigue, forme et zone, puis chaque charge du jour : activité ou retour de séance, sa valeur et sa méthode (puissance, allure, FC, ressenti) ; séance prévue, avec sa case de simulation.
- **Période** : 6 semaines, 3 mois (par défaut), 6 mois ou 1 an d'historique ; le calcul remonte toujours 120 jours avant le début de l'année affichable.
- **Condition sur 7 jours** : variation de la condition sur la dernière semaine, affichée sans jugement (« en hausse », « stable », « en baisse »).

Calcul de la simulation : `simulate(modèle, scénario)` dans `src/lib/stats/fitness.ts`, partagé entre le serveur (plan publié, chiffres du jour et à 7 jours) et le navigateur (scénarios). Le modèle tient l'état de la veille (condition et fatigue), la charge déjà faite aujourd'hui et les séances prévues jusqu'à l'horizon.

## Strava

Les activités Strava ne sont **jamais** comptées : l'accord API Strava (version du 1er juin 2026, §5.4) interdit les analyses et agrégations de ses données, même dérivées. L'écran le dit. Pour un historique fidèle, l'athlète importe ses fichiers FIT (l'archive .zip de Garmin Connect est acceptée) ou donne son retour après chaque séance.

## Zones de forme

Demandées le 31 octobre : récup, zone grise, amélioration, optimal, attention blessure. Repères de Joe Friel, repris par Intervals.icu (zone grise de −10 à +5, risque sous −30) ; la zone d'entraînement de −10 à −30 est partagée en deux :

| Zone | Forme | Sens |
| --- | --- | --- |
| Récup | au-dessus de +5 | reposé, la fatigue est partie : bon moment pour une course ; au-delà de +20 longtemps, la condition baisse |
| Zone grise | de −10 à +5 | charge d'entretien : peu de progrès |
| Amélioration | de −20 à −10 | la charge fait progresser, avec une fatigue modérée |
| Optimal | de −30 à −20 | charge la plus utile : forte progression, à condition de récupérer ensuite |
| Attention blessure | sous −30 | fatigue très forte : risque de blessure ou de surentraînement si cela dure |

Les cinq bandes sont colorées et nommées sur la courbe de forme, la ligne prend la couleur de la zone traversée, une légende donne les limites, et la zone du jour est expliquée sous les chiffres. Limites dans `FORM_ZONES` (`src/lib/stats/fitness.ts`) : à ajuster d'un seul endroit.

## Affichage

Condition (bleu, aire) et fatigue (violet) en haut, forme colorée par zone en bas, sur fond des zones ; la prévision est en pointillés, après le trait « aujourd'hui », et le repos supposé en pointillés fins. Jour pointé au doigt (touché), à la souris (survol, clic pour le garder) ou au clavier (flèches, Page précédente et suivante pour une semaine, Origine, Fin). Sous le graphique : le détail du jour, la forme prévue au départ des courses, la simulation, puis ce qui est compté (fichiers FIT, montre, retours, séances prévues) et ce qui ne l'est pas, avec la raison.
