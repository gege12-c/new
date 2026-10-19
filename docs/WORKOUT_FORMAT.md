# Format des séances structurées (version 1)

Source de vérité : [`src/lib/workout`](../src/lib/workout) (schéma Zod, calculs, avertissements, mise en forme).
La base vérifie la forme générale (`private.is_workout_document`) ; l'application valide tout le reste avant d'enregistrer.

## Structure

```text
Séance
└── segments[]            1 à 6 ; plusieurs disciplines = enchaînement
    └── steps[]           étapes et répétitions, dans l'ordre
        ├── step          une étape
        └── repeat        N × (étapes ou répétitions), 3 niveaux au plus
```

```json
{
  "schemaVersion": 1,
  "segments": [
    {
      "id": "seg-bike",
      "sport": "bike",
      "title": "Seuil 4 × 8 min",
      "steps": [
        { "kind": "step", "id": "wu", "type": "warmup", "length": { "unit": "time", "seconds": 900 },
          "targets": [{ "metric": "power", "unit": "percent_ftp", "min": 55, "max": 70 }] },
        { "kind": "repeat", "id": "main", "count": 4, "steps": [
          { "kind": "step", "id": "work", "type": "active", "length": { "unit": "time", "seconds": 480 },
            "targets": [{ "metric": "power", "unit": "percent_ftp", "min": 95, "max": 100 },
                        { "metric": "cadence", "unit": "rpm", "min": 85, "max": 95 }] },
          { "kind": "step", "id": "rec", "type": "recovery", "length": { "unit": "time", "seconds": 180 },
            "targets": [{ "metric": "power", "unit": "zone", "min": 1, "max": 1 }] }
        ] },
        { "kind": "step", "id": "cd", "type": "cooldown", "length": { "unit": "time", "seconds": 600 } }
      ]
    }
  ]
}
```

D'autres exemples (natation avec départs, enchaînement vélo-course) : [`fixtures.ts`](../src/lib/workout/fixtures.ts).

### Étape

| Champ | Contenu |
| --- | --- |
| `type` | `warmup`, `active`, `recovery`, `rest`, `cooldown`, `drill` (éducatifs), `transition` |
| `length` | `time` (secondes), `distance` (mètres), `reps` (renforcement) ou `open` (jusqu'au bouton tour) |
| `targets` | 0 à 2 cibles de métriques différentes ; la première est la cible principale |
| `sendOffSeconds` | natation : départ toutes les N secondes, effort et récupération compris |
| `label`, `notes`, `equipment` | intitulé court, consignes, matériel (pull-buoy, plaquettes, palmes…) |

### Cibles

Une cible est une plage `min`–`max`. Pour une allure, `min` est la borne **rapide** (moins de secondes).

| Métrique | Unités | Disciplines |
| --- | --- | --- |
| `power` | `watts`, `percent_ftp`, `zone` (1–7) | vélo ; `watts` aussi en course |
| `heart_rate` | `bpm`, `percent_lthr`, `percent_max_hr`, `zone` (1–5) | toutes (zones et % FC seuil : vélo et course) |
| `pace` | `sec_per_km` (course), `sec_per_100m` (natation), `percent_threshold`, `zone` (1–5) | course, natation |
| `speed` | `kmh` | vélo, course |
| `cadence` | `rpm` (vélo), `spm` (course) | vélo, course |
| `rpe` | `scale` (1–10) | toutes |

`percent_threshold` est un pourcentage de la **vitesse** au seuil : 105 % est plus rapide que l'allure seuil (course) ou la CSS (natation).

## Zones par défaut

| Zone | Puissance (% FTP, Coggan) | FC vélo (% FC seuil) | FC course (% FC seuil) | Allure course (% vitesse seuil) | Natation (% vitesse CSS) |
| --- | --- | --- | --- | --- | --- |
| 1 | 0–55 | 50–80 | 50–84 | 60–77 | 70–84 |
| 2 | 56–75 | 81–89 | 85–89 | 78–87 | 85–92 |
| 3 | 76–90 | 90–93 | 90–94 | 88–94 | 93–97 |
| 4 | 91–105 | 94–99 | 95–99 | 95–101 | 98–102 |
| 5 | 106–120 | 100–106 | 100–106 | 102–112 | 103–112 |
| 6 | 121–150 | | | | |
| 7 | 151–200 | | | | |

Des zones personnalisées par athlète pourront remplacer ces modèles plus tard.

## Calculs : exact, estimé ou inconnu

Rien n'est inventé : chaque durée ou distance est **exacte** (prescrite), **estimée** (déduite d'une hypothèse documentée) ou **inconnue**.

| Étape | Durée | Distance |
| --- | --- | --- |
| en temps | exacte | estimée depuis une cible d'allure ou de vitesse ; sinon inconnue |
| en distance | estimée depuis une cible d'allure ou de vitesse ; exacte avec un départ natation | exacte |
| répétitions, durée libre | inconnue | inconnue |
| repos, transition, renforcement | selon la longueur | 0 |

Hypothèses d'estimation :

- une cible en % ou en zone se résout avec les **seuils en vigueur à la date de la séance** ;
- une cible cardiaque en zone est rapprochée de la zone d'allure de même rang ;
- une étape facile (échauffement, récupération, retour au calme, éducatifs) sans cible d'intensité se fait à 80 % de la vitesse seuil en course et 85 % de la vitesse CSS en natation ;
- en vélo, sans cible de vitesse, la distance reste inconnue : elle dépend du terrain.

Le total vaut `exact`, `estimated`, `partial` (une partie inconnue) ou `unknown` ; l'interface affiche cet état.

## Avertissements

Ils informent le coach et ne modifient jamais la séance.

| Code | Situation |
| --- | --- |
| `missing_threshold` | une cible relative ne peut pas être convertie faute de seuil |
| `duration_unknown` | des étapes n'ont pas de durée calculable |
| `above_max_hr` | cible cardiaque au-dessus de la FC max renseignée |
| `sustained_high_intensity` | effort continu inhabituellement long au-dessus du seuil |
| `recovery_harder_than_work` | récupération aussi intense que l'effort précédent |
| `intense_warmup` | échauffement ou retour au calme au niveau du seuil |
| `rest_with_target` | étape de repos avec une cible |
| `transition_outside_brick` | transition dans une séance d'une seule discipline |
| `single_repeat` | répétition exécutée une seule fois |
| `very_short_step` | étape de moins de 5 s |
| `very_long_total` | durée totale inhabituelle pour la discipline |
| `wide_target_range` | plage de cible trop large pour guider l'athlète |

## Exports

Les exports (.zwo pour Zwift, FIT de séance pour Garmin, fiche texte) convertissent ce format sans jamais le modifier : chaque écart (cible approchée, information perdue, export impossible) est annoncé avant le téléchargement. Règles de conversion et conditions des fournisseurs : [EXPORTS.md](EXPORTS.md).
