# Condition physique, fatigue et forme

Page « Progression » (athlète, et onglet de la fiche athlète côté coach), bloc « Condition physique ». Demandé le 19 octobre 2026 (initialement hors V1, « CTL/ATL/TSB avec méthode documentée ») ; code : `src/lib/stats/fitness.ts`, données : `src/lib/data/fitness.ts`.

## Modèle

Modèle impulsion-réponse de Banister, dans la forme popularisée par TrainingPeaks (CTL, ATL, TSB) et reprise par Intervals.icu :

- **charge** d'un jour : somme des charges de ses séances, en points de TSS (une heure au seuil = 100) ;
- **condition** (CTL) : `condition(j) = condition(j−1) + (charge(j) − condition(j−1)) / 42` ;
- **fatigue** (ATL) : la même chose sur 7 jours ;
- **forme** (TSB) : `condition(j) − fatigue(j)`, le même jour (comme Intervals.icu).

Le calcul part de zéro 120 jours avant la fenêtre affichée (13 semaines passées), pour que la condition affichée n'y parte pas de zéro. Avec moins de 42 jours d'historique réel, l'écran indique que la condition est encore sous-estimée.

## Charge d'une séance

`charge = heures × intensité² × 100`, l'intensité étant le rapport au seuil, bornée entre 0,3 et 1,5 (un capteur aberrant ne fait pas exploser la courbe). Natation : intensité au cube, comme le sTSS.

| Source | Intensité | Qualité |
| --- | --- | --- |
| Fichier FIT, vélo | puissance normalisée / FTP (à défaut, puissance moyenne / FTP) | exacte (estimée sans puissance normalisée) |
| Fichier FIT, course | vitesse moyenne / vitesse au seuil (allure seuil) | estimée (vitesse moyenne, pas de NGP) |
| Fichier FIT, natation | vitesse moyenne / CSS | estimée |
| Fichier FIT, autres cas | FC moyenne / FC seuil (vélo ou course) | estimée (approximation du hrTSS) |
| Fichier FIT sans mesure exploitable | ressenti (RPE) donné pour la séance rattachée, sur la durée du fichier | estimée ; sinon non comptée |
| Retour de séance « faite » sans fichier FIT | ressenti (RPE) sur la durée prévue ; sans ressenti, la charge prévue de la séance | estimée |
| Retour « en partie » | non comptée : la part faite n'est pas connue | — |
| Séance prévue (prévision) | étape par étape : % FTP, % seuil, zones, RPE, ou valeurs absolues rapportées aux seuils du jour | estimée ; une étape sans intensité exprimable n'est pas comptée (l'écran le dit) |

RPE en intensité : 1 → 45 %, 2 → 52 %, 3 → 62 %, 4 → 70 %, 5 → 80 %, 6 → 87 %, 7 → 95 %, 8 → 102 %, 9 → 113 %, 10 → 125 % du seuil (interpolé), calé sur les zones (RPE 7–8 = seuil). Les seuils utilisés sont ceux en vigueur à la date de chaque séance.

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

Repères de Joe Friel, repris par Intervals.icu : transition au-dessus de +20, fraîcheur de +5 à +20, zone grise de −10 à +5, zone optimale de −30 à −10, risque élevé sous −30.

## Affichage

Condition (bleu, aire) et fatigue (violet) en haut, forme colorée par zone en bas, sur fond des zones ; la prévision est en pointillés, après le trait « aujourd'hui », et le repos supposé en pointillés fins. Jour pointé au doigt (touché), à la souris (survol, clic pour le garder) ou au clavier (flèches, Page précédente et suivante pour une semaine, Origine, Fin). Sous le graphique : le détail du jour, la forme prévue au départ des courses, la simulation, puis ce qui est compté (fichiers FIT, montre, retours, séances prévues) et ce qui ne l'est pas, avec la raison.
