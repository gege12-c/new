/**
 * Capacités réelles de chaque fournisseur, vérifiées dans sa documentation officielle (sources
 * citées, voir docs/EXPORTS.md). Données pures, utilisables côté client comme côté serveur.
 *
 * Quatre cas sont distingués :
 * - planned : export d'une séance prévue vers l'appareil ou l'application ;
 * - realized : import d'une activité réalisée ;
 * - auto : synchronisation automatique (sans geste de l'athlète) ;
 * - download : téléchargement manuel d'un fichier.
 */
import type { SegmentSport } from "@/lib/workout/schema";
import type { ExportFormat, ProviderId } from "./types";

export type ExportCase = "planned" | "realized" | "auto" | "download";
export type CapabilityStatus = "available" | "manual" | "not_configured" | "unsupported";

export interface Capability {
  status: CapabilityStatus;
  detail: string;
}

export interface ConnectorInfo {
  id: ProviderId;
  name: string;
  /** Format de fichier produit, s'il y en a un. */
  format: ExportFormat | null;
  /** Disciplines exportables. */
  sports: readonly SegmentSport[];
  capabilities: Record<ExportCase, Capability>;
  /** Procédure d'import officielle, pas à pas. */
  procedure: string[];
  /** Ce qu'il faudrait pour un envoi automatique. */
  prerequisites: string[];
  sources: { label: string; url: string }[];
}

export const CASE_LABELS: Record<ExportCase, string> = {
  planned: "Séance prévue vers l'appareil",
  realized: "Activité réalisée vers TriCoach",
  auto: "Synchronisation automatique",
  download: "Téléchargement manuel",
};

const REALIZED_VIA_STRAVA_OR_FIT: Capability = {
  status: "available",
  detail: "Par Strava (si l'appareil y envoie ses activités) ou en important le fichier FIT de l'activité dans TriCoach.",
};

/** Relais intervals.icu : partenaire officiel de Suunto, Garmin et COROS (voir docs/WATCHES.md). */
const VIA_INTERVALS = {
  planned: "Par intervals.icu (relais officiel et gratuit), une fois relié dans le profil : chaque séance publiée part seule vers la montre.",
  auto: "Par intervals.icu, une fois relié dans le profil : les séances publiées des 14 prochains jours sont déposées dans son calendrier, qui les transmet à la montre la semaine qui précède ; mises à jour ou retirées quand elles changent.",
};
const INTERVALS_SOURCES = {
  suunto: { label: "intervals.icu : envoi des séances vers les montres Suunto", url: "https://forum.intervals.icu/t/upload-workouts-to-suunto-watches/9560" },
  garmin: { label: "intervals.icu : envoi des séances vers Garmin Connect", url: "https://forum.intervals.icu/t/upload-planned-workouts-to-garmin-connect/1521" },
  coros: { label: "intervals.icu : envoi des séances vers COROS", url: "https://forum.intervals.icu/t/coros-support-added/37006" },
  api: { label: "intervals.icu : accès à l'API (clé personnelle)", url: "https://forum.intervals.icu/t/api-access-to-intervals-icu/609" },
};

export const ZWIFT: ConnectorInfo & { id: "zwift"; format: "zwo" } = {
  id: "zwift",
  name: "Zwift",
  format: "zwo",
  sports: ["bike", "run"],
  capabilities: {
    planned: { status: "manual", detail: "Fichier .zwo (vélo et course) à importer dans Zwift, sur ordinateur." },
    realized: REALIZED_VIA_STRAVA_OR_FIT,
    auto: { status: "unsupported", detail: "Zwift n'offre pas d'API publique pour envoyer des séances." },
    download: { status: "available", detail: "Fichier .zwo, contrôlé avant téléchargement." },
  },
  procedure: [
    "Téléchargez le fichier .zwo sur un ordinateur (Mac ou PC) où Zwift est installé : l'import ne se fait pas depuis un téléphone ou une tablette.",
    "Mac : Finder > Documents > Zwift > Workouts, puis le dossier à votre numéro Zwift (des chiffres) ; collez-y le fichier.",
    "PC : clic droit sur l'icône Z de Zwift dans la zone de notification > Open Logs Folder, puis Zwift > Workouts et le dossier à votre numéro Zwift ; collez-y le fichier.",
    "Redémarrez Zwift : la séance est disponible dans vos séances personnalisées, sur tous vos appareils (fichiers de moins de 64 Ko).",
    "Course à pied : les allures sont exprimées par rapport à l'allure 10 km de votre profil Zwift ; vérifiez qu'elle est à jour.",
  ],
  prerequisites: [],
  sources: [{ label: "Zwift : séances personnalisées (import .zwo)", url: "https://support.zwift.com/en_us/custom-workouts-ryGOTVEPs" }],
};

export const GARMIN: ConnectorInfo & { id: "garmin"; format: "fit" } = {
  id: "garmin",
  name: "Garmin",
  format: "fit",
  sports: ["bike", "run", "swim", "strength", "other"],
  capabilities: {
    planned: { status: "manual", detail: "Fichier FIT de séance à copier sur la montre ou le compteur par câble USB." },
    realized: REALIZED_VIA_STRAVA_OR_FIT,
    auto: {
      status: "available",
      detail: `${VIA_INTERVALS.auto} Autre voie : l'application TriCoach pour montre (Connect IQ), installée par câble en attendant le Connect IQ Store.`,
    },
    download: { status: "available", detail: "Fichier FIT de type séance, écrit avec le SDK officiel de Garmin et relu avant téléchargement." },
  },
  procedure: [
    "Branchez la montre ou le compteur à l'ordinateur avec le câble USB.",
    "Ouvrez l'appareil dans l'explorateur de fichiers, puis le dossier GARMIN/NewFiles.",
    "Copiez-y le fichier .fit, puis éjectez proprement l'appareil.",
    "La séance apparaît dans Entraînement > Séances (redémarrez l'appareil si besoin). L'appui sur le bouton tour passe à l'étape suivante.",
    "Garmin Connect (site ou application) n'importe pas les fichiers de séance : seule la copie par câble fonctionne sans l'API.",
  ],
  prerequisites: [
    "Application TriCoach pour montre : installée par câble USB en attendant sa publication sur le Connect IQ Store (ouverte à tout développeur, après examen par Garmin), puis associée au compte de l'athlète avec le code qu'elle affiche (Profil sportif, « Montre Garmin »).",
    "Calendrier Garmin Connect : accès au Garmin Connect Developer Program (API Training), réservé aux entreprises ; nouvelles demandes suspendues par Garmin depuis le printemps 2026.",
  ],
  sources: [
    INTERVALS_SOURCES.garmin,
    { label: "Garmin : Connect IQ, contenu téléchargé sur la montre (PersistedContent)", url: "https://developer.garmin.com/connect-iq/api-docs/Toybox/PersistedContent.html" },
    { label: "Garmin : Connect IQ, tâches de fond et réveil de l'application", url: "https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html" },
    { label: "Garmin : API Training (Connect Developer Program)", url: "https://developer.garmin.com/gc-developer-program/training-api" },
    { label: "TrainingPeaks : copier une séance FIT sur un appareil Garmin", url: "https://help.trainingpeaks.com/hc/en-us/articles/115001076908-Structured-Workout-Export-for-Garmin-Devices" },
  ],
};

export const WAHOO: ConnectorInfo & { id: "wahoo"; format: null } = {
  id: "wahoo",
  name: "Wahoo",
  format: null,
  sports: [],
  capabilities: {
    planned: {
      status: "not_configured",
      detail: "Les séances planifiées arrivent sur les compteurs ELEMNT par l'API Cloud de Wahoo (plans), ouverte sur demande et après approbation.",
    },
    realized: REALIZED_VIA_STRAVA_OR_FIT,
    auto: { status: "not_configured", detail: "Possible avec l'API Cloud de Wahoo une fois l'accès accordé." },
    download: {
      status: "unsupported",
      detail: "Wahoo ne documente pas d'import manuel de fichier de séance : utilisez la fiche à recopier, ou le fichier .zwo dans Zwift sur home trainer.",
    },
  },
  procedure: [
    "Sans l'API, Wahoo n'accepte les séances planifiées que de ses partenaires agréés (liste sur le support Wahoo).",
    "Sur home trainer Wahoo (KICKR…) : utilisez l'export Zwift.",
    "Sur route : suivez la séance depuis TriCoach sur votre téléphone, ou recopiez-la à partir de la fiche texte.",
  ],
  prerequisites: [
    "Demande d'accès à l'API Cloud de Wahoo (application de production distincte de la sandbox, portées plans_write), puis approbation par Wahoo.",
    "Une fois l'accès obtenu : connexion OAuth du compte Wahoo de l'athlète et envoi des séances sous forme de plans.",
  ],
  sources: [
    { label: "Wahoo : API Cloud (développeurs)", url: "https://developers.wahooligan.com/cloud" },
    { label: "Wahoo : applications partenaires", url: "https://support.wahoofitness.com/hc/en-us/articles/23022859474962" },
  ],
};

export const SUUNTO: ConnectorInfo & { id: "suunto"; format: null } = {
  id: "suunto",
  name: "Suunto",
  format: null,
  sports: [],
  capabilities: {
    planned: { status: "available", detail: `${VIA_INTERVALS.planned} En direct par l'API Cloud de Suunto dès que TriCoach en aura l'accès partenaire.` },
    realized: REALIZED_VIA_STRAVA_OR_FIT,
    auto: { status: "available", detail: VIA_INTERVALS.auto },
    download: {
      status: "unsupported",
      detail: "Pas d'import de fichier de séance : recopiez-la dans l'application Suunto avec la fiche « étapes Suunto », écrite comme son créateur d'entraînements.",
    },
  },
  procedure: [
    "Dans l'application Suunto, touchez « + » en haut à droite, puis « Créez un entraînement structuré » (ou : symbole de la montre, « Entraînements structurés », « Créez nouveau »).",
    "Recopiez le nom, la description, le mode sportif et la date de la fiche ci-dessous : avec la date, la montre propose la séance ce jour-là.",
    "Ajoutez les étapes et les répétitions dans l'ordre de la fiche : pour chacune, son type, sa fin (durée, distance ou bouton tour) et son objectif.",
    "Touchez « Suivant », vérifiez le récapitulatif, puis enregistrez : la séance part sur la montre à la synchronisation, parmi les SuuntoPlus Guides.",
    "Sur la montre, choisissez le sport : la montre propose la séance du jour ; sinon, Options, SuuntoPlus, Guides, puis la séance, avant de démarrer.",
  ],
  prerequisites: [
    "Accès à l'API Cloud de Suunto (apizone.suunto.com) : abonnement activé par Suunto, puis une application OAuth dont l'adresse de retour est celle de TriCoach.",
    "Les identifiants de cette application saisis dans la configuration du site ; chaque athlète relie ensuite son compte Suunto depuis son profil.",
  ],
  sources: [
    INTERVALS_SOURCES.suunto,
    { label: "Suunto : programme API (APIZone)", url: "https://apizone.suunto.com/" },
    { label: "Suunto : créer un entraînement structuré dans l'application", url: "https://www.suunto.com/fr-ch/Assistance/faq-articles/suunto-app/how-can-i-create-structured-workouts-with-suunto-app/" },
    { label: "Suunto : planifier des séances fractionnées", url: "https://us.suunto.com/blogs/blog/plan-your-interval-workouts-with-suunto-app" },
  ],
};

export const COROS: ConnectorInfo & { id: "coros"; format: null } = {
  id: "coros",
  name: "COROS",
  format: null,
  sports: [],
  capabilities: {
    planned: { status: "available", detail: VIA_INTERVALS.planned },
    realized: REALIZED_VIA_STRAVA_OR_FIT,
    auto: { status: "available", detail: VIA_INTERVALS.auto },
    download: { status: "unsupported", detail: "COROS ne documente pas d'import manuel de fichier de séance : passez par intervals.icu." },
  },
  procedure: [
    "Créez un compte gratuit sur intervals.icu, puis reliez-y COROS dans ses réglages (encadré COROS) et cochez l'envoi des séances prévues.",
    "Dans TriCoach, Profil sportif, « Séances sur la montre » : collez la clé API d'intervals.icu.",
    "Dans l'application COROS, ajoutez si besoin le calendrier « Intervals.icu Training Plan » : les séances de la semaine y arrivent, puis sur la montre.",
  ],
  prerequisites: [],
  sources: [INTERVALS_SOURCES.coros, INTERVALS_SOURCES.api],
};

export const CONNECTORS = [ZWIFT, GARMIN, WAHOO, SUUNTO, COROS] as const;

/** Suunto quand le site a l'accès partenaire : l'envoi sur la montre est en place. */
export const SUUNTO_LIVE: ConnectorInfo = {
  ...SUUNTO,
  capabilities: {
    ...SUUNTO.capabilities,
    planned: { status: "available", detail: "Guide SuuntoPlus envoyé sur la montre par l'API Cloud de Suunto, après connexion du compte Suunto dans le profil." },
    auto: {
      status: "available",
      detail: "Chaque séance publiée des 7 prochains jours part seule sur la montre (écran par étape, cible, compte à rebours), mise à jour ou retirée quand elle change.",
    },
  },
};
