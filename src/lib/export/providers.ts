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
      status: "not_configured",
      detail:
        "Application TriCoach pour montre (Connect IQ) : elle charge vos séances des 7 prochains jours en vraies séances Garmin et vérifie seule, toutes les 30 minutes, si une séance est à charger (une confirmation sur la montre reste nécessaire : Garmin n'autorise pas l'enregistrement d'une séance en arrière-plan). Pas encore sur le Connect IQ Store : installation par câble en attendant. L'envoi vers le calendrier Garmin Connect (API Training) attend la réouverture des demandes chez Garmin.",
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
    planned: {
      status: "not_configured",
      detail: "Les séances structurées arrivent sur la montre comme « guides SuuntoPlus », par l'API partenaire de Suunto, ouverte aux entreprises après examen.",
    },
    realized: REALIZED_VIA_STRAVA_OR_FIT,
    auto: { status: "not_configured", detail: "Possible avec l'API partenaire de Suunto une fois l'accès accordé." },
    download: {
      status: "unsupported",
      detail: "Pas d'import de fichier de séance : recréez la séance dans l'application Suunto à partir de la fiche texte.",
    },
  },
  procedure: [
    "Dans l'application Suunto, ouvrez l'onglet de la montre puis le créateur de séances (Workout planner).",
    "Recréez les étapes à partir de la fiche texte (durée ou distance, cible de FC, puissance, allure ou vitesse).",
    "Donnez une date à la séance : elle est synchronisée sur la montre comme guide SuuntoPlus.",
    "Sur la montre : choisissez le sport, puis Options > SuuntoPlus > Guides et la séance, avant de démarrer.",
  ],
  prerequisites: [
    "Candidature au programme API de Suunto (réservé aux entreprises proposant un service au public, examen sous deux semaines, contrat API).",
    "Une fois l'accès obtenu : connexion du compte Suunto de l'athlète et envoi des séances comme guides.",
  ],
  sources: [
    { label: "Suunto : programme API (APIZone)", url: "https://apizone.suunto.com/" },
    { label: "Suunto : planifier des séances fractionnées", url: "https://us.suunto.com/blogs/blog/plan-your-interval-workouts-with-suunto-app" },
  ],
};

export const CONNECTORS = [ZWIFT, GARMIN, WAHOO, SUUNTO] as const;
