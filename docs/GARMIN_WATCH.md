# Application TriCoach pour montre Garmin

Application Connect IQ (dossier `watch/`, langage Monkey C) qui met les séances TriCoach sur la montre en vraies séances Garmin : écrans, alertes et cibles de la montre, sans câble au quotidien. Elle passe par le téléphone (application Garmin Connect, en Bluetooth) pour joindre TriCoach.

Pourquoi une application sur la montre : Garmin ne laisse envoyer une séance sur une montre que par ses partenaires (API Training, nouvelles demandes suspendues depuis le printemps 2026, voir [PARTNERS.md](PARTNERS.md)) ou par une application installée sur la montre. Une application de téléphone ne peut pas y déposer de séance.

## Ce qu'elle fait

- **Association** : à la première ouverture, la montre affiche un code de 8 caractères ; l'athlète le saisit dans TriCoach (Profil sportif, « Montre Garmin »). La montre reçoit alors son jeton, une seule fois. Dissocier la montre dans le profil coupe son accès aussitôt.
- **Ouverture** : la montre charge la liste des séances publiées d'aujourd'hui à J+6. Si la prochaine séance n'est pas encore sur la montre (nouvelle, ou modifiée par le coach depuis) et tient en une partie, elle se charge seule ; la montre propose ensuite de la démarrer (« Oui » ouvre l'écran de départ Garmin, « Non » la garde dans les entraînements de la montre pour plus tard).
- **Liste** : le bouton de sélection ouvre les 7 prochains jours ; un enchaînement se charge partie par partie (une séance Garmin par discipline).
- **Vérification en tâche de fond** : toutes les 30 minutes, par le téléphone, la montre demande à TriCoach la prochaine séance et sa version. Si elle ne l'a pas encore, elle affiche « TriCoach : séance à charger » ; un appui ouvre l'application, qui la charge. Une seule demande par version de séance, entre 7 h et 21 h, jamais en mode « ne pas déranger ». Garmin interdit l'enregistrement d'une séance en tâche de fond : cette confirmation est le plus près de l'automatique que Garmin permet.
- **Vue rapide** (glance, montres récentes) : la prochaine séance, sans réseau.

Ce que la montre reçoit : les séances publiées des 7 prochains jours (titre, date, durée, contenu converti en séance Garmin) et les seuils nécessaires aux cibles, rien d'autre. Les séances faites reviennent par Strava ou les fichiers FIT, comme avant.

Une seule séance TriCoach à la fois dans les entraînements de la montre : charger une séance retire la précédente chargée par TriCoach (jamais celles créées ailleurs).

Montres prises en charge : les 106 modèles qui savent télécharger une séance (liste dans `watch/manifest.xml`) : Forerunner 55 à 970, Fenix 5 à 8, Epix, Enduro, Venu, Vivoactive 4 à 6, Instinct 2 et 3, MARQ, Descent et D2. Les compteurs Edge n'y sont pas pour l'instant : pour eux, le fichier FIT par câble.

## Côté serveur

| Route | Rôle |
| --- | --- |
| `POST /api/watch/pair` | la montre demande un code (10 minutes de validité) |
| `POST /api/watch/token` | la montre récupère son jeton, une fois le code saisi par l'athlète |
| `GET /api/watch/sessions` | résumé des séances d'aujourd'hui à J+6 (jeton dans l'en-tête `Authorization`) |
| `GET /api/watch/sessions/:id/fit?part=n` | fichier FIT de séance d'une partie, écrit et relu avec le SDK FIT officiel |
| `GET /api/watch/changes` | prochaine séance et sa version, pour la vérification en tâche de fond (réponse minuscule) |

Les réponses JSON ont le statut HTTP 200 même pour un refus (champ `status`) : certaines montres ne transmettent pas le corps d'une réponse d'erreur. Base : tables `watch_pairings` et `watch_devices`, fonctions `start_watch_pairing`, `confirm_watch_pairing`, `claim_watch_token`, `revoke_watch_device`, `watch_sessions` ([SCHEMA.md](SCHEMA.md)). Jetons et codes gardés sous forme d'empreinte, illisibles par l'API.

## Compiler l'application

La compilation demande le SDK officiel de Garmin, téléchargeable avec un compte Garmin après acceptation de son contrat de licence. Elle se fait dans GitHub (workflow « Montre Garmin ») ; à chaque modification du dossier `watch/`, les vérifications sans SDK tournent de toute façon (`npm run watch:check` : syntaxe Monkey C, textes, manifeste).

À faire une fois, dans le dépôt GitHub (Settings, « Secrets and variables », « Actions ») :

1. **Compte Garmin pour la compilation** : créez de préférence un compte Garmin à part (gratuit, sur garmin.com), sans validation en deux étapes : l'outil de Garmin ne sait pas répondre à un code envoyé par SMS ou email. Onglet « Secrets », « New repository secret » : `GARMIN_USERNAME` (l'adresse email du compte) et `GARMIN_PASSWORD` (son mot de passe).
2. **Clé de signature** : secret `WATCH_SIGNING_SEED`, une phrase d'au moins 24 caractères que vous inventez et gardez dans votre gestionnaire de mots de passe. La même phrase redonne toujours la même clé, ce qu'exige le Connect IQ Store d'une version à l'autre ; la clé n'existe que pendant la compilation. Sans ce secret, la compilation utilise une clé jetable, valable seulement pour l'installation par câble.
3. **Contrat de licence du SDK** : onglet « Actions », workflow « Montre Garmin », « Run workflow ». La première exécution s'arrête volontairement et affiche, dans son résumé, le lien du contrat et son empreinte (« Current Hash »). Lisez le contrat ; si vous l'acceptez, onglet « Variables », « New repository variable » : `CIQ_AGREEMENT_HASH` = cette empreinte. Relancez le workflow. Quand Garmin met son contrat à jour, le workflow le signale : relisez-le et remplacez l'empreinte.

Résultat : l'artefact « TriCoach-montre » de l'exécution (en bas de sa page), avec `TriCoach.iq` (paquet pour le Connect IQ Store) et `prg/TriCoach-<montre>.prg` (un fichier par modèle : `fr965` pour la Forerunner 965, `fenix7` pour la Fenix 7, etc.).

## Installer sur votre montre

Par câble (fonctionne aujourd'hui) :

1. Téléchargez l'artefact « TriCoach-montre » et décompressez-le ; prenez le fichier `.prg` de votre modèle.
2. Branchez la montre à l'ordinateur avec son câble. Windows : elle apparaît dans l'explorateur de fichiers. Mac : installez d'abord OpenMTP (gratuit), qui affiche la mémoire des montres récentes.
3. Copiez le fichier dans le dossier `GARMIN/APPS` de la montre, puis éjectez-la.
4. Sur la montre, TriCoach apparaît parmi les widgets (vue rapide) ; ajoutez-le à la boucle des widgets si besoin (réglages de la montre, « Widgets » ou « Vues rapides »).
5. Ouvrez TriCoach : le code s'affiche ; dans TriCoach sur le téléphone, Profil sportif, « Montre Garmin », saisissez-le.

Pour une nouvelle version : recompilez (« Run workflow ») et recopiez le fichier `.prg` au même endroit ; l'association est en principe conservée (sinon, nouveau code à saisir). Une application installée par câble ne se met pas à jour seule.

Par le Connect IQ Store (pour vos athlètes, plus tard) : avec le secret `WATCH_SIGNING_SEED` en place dès le premier envoi, envoyez `TriCoach.iq` depuis le tableau de bord développeur de Garmin (apps.garmin.com, compte développeur gratuit), puis soumettez l'application à l'examen de Garmin. Une version « bêta » privée existe, mais son installation sur la montre est signalée comme peu fiable par les développeurs depuis fin 2025. Une fois l'application publiée, mettez son adresse dans `src/lib/watch/app.ts` (`storeUrl`) : le profil sportif affichera le lien du store.

## Limites

- Pas encore compilée ni essayée sur une vraie montre : le SDK Garmin ne se télécharge pas depuis l'environnement de développement de TriCoach. La logique serveur est testée de bout en bout en jouant le rôle de la montre (`e2e/watch.spec.ts`), le code Monkey C est vérifié pour la syntaxe et les ressources ; la première compilation dans GitHub peut révéler des erreurs que je corrigerai.
- Une confirmation sur la montre reste nécessaire pour charger une séance (règle de Garmin, voir plus haut).
- Sur les montres sans vue rapide (où les widgets défilent), la prochaine séance ne se charge pas seule à l'ouverture, pour qu'un simple passage dans la boucle des widgets ne déclenche rien : un appui sur le bouton de sélection ouvre la liste.

## Sources

- [Garmin, Connect IQ : PersistedContent (séances téléchargées)](https://developer.garmin.com/connect-iq/api-docs/Toybox/PersistedContent.html)
- [Garmin, Connect IQ : Background (tâches de fond, demande d'ouverture)](https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html)
- [Garmin, Connect IQ : Communications (requêtes par le téléphone)](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)
- [Forum Garmin : PersistedContent indisponible en tâche de fond](https://forums.garmin.com/developer/connect-iq/f/discussion/356255/can-you-use-persistedcontent-in-background)
- [Forum Garmin : installation des applications bêta](https://forums.garmin.com/developer/connect-iq/f/connect-iq-web-store/427577/how-does-one-install-a-beta-app)
- [Outil en ligne de commande du SDK (connect-iq-sdk-manager-cli)](https://github.com/lindell/connect-iq-sdk-manager-cli)
- [TrainAsONE, application Connect IQ de référence (licence BSD)](https://github.com/TrainAsONE/trainasone-connectiq)
