/** Textes et liens des notifications, à partir de leur type et des libellés figés au moment de l'évènement. */
export const NOTIFICATION_KINDS = ["session_published", "session_updated", "session_cancelled", "comment", "reconnect", "export_failed", "missing_feedback"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const KIND_LABELS: Record<NotificationKind, { label: string; hint: string; audience: "all" | "athlete" | "coach" }> = {
  session_published: { label: "Nouvelle séance publiée", hint: "Une séance ajoutée à votre calendrier (ou à celui d’un athlète).", audience: "all" },
  session_updated: { label: "Séance modifiée ou déplacée", hint: "Contenu, horaire ou date d’une séance publiée.", audience: "all" },
  session_cancelled: { label: "Séance annulée", hint: "Une séance publiée qui n’est plus au programme.", audience: "all" },
  comment: { label: "Commentaire sur une séance", hint: "Les commentaires partagés ; jamais les notes privées.", audience: "all" },
  reconnect: { label: "Reconnexion Strava nécessaire", hint: "Quand Strava refuse l’accès (autorisation expirée ou retirée).", audience: "athlete" },
  export_failed: { label: "Export impossible chez un athlète", hint: "Pour corriger la séance quand un export Zwift ou Garmin échoue.", audience: "coach" },
  missing_feedback: { label: "Séance de la veille sans retour", hint: "Un rappel le lendemain matin, une seule fois par séance.", audience: "athlete" },
};

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  athlete_id: string | null;
  session_id: string | null;
  actor_name: string | null;
  athlete_name: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

const PROVIDERS: Record<string, string> = { zwift: "Zwift", garmin: "Garmin", strava: "Strava" };

function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Phrase de la notification, du point de vue du destinataire. */
export function notificationText(n: NotificationItem, viewerId: string): string {
  const title = text(n.payload.title);
  const forAthlete = n.athlete_id && n.athlete_id !== viewerId && n.athlete_name ? ` (${n.athlete_name})` : "";
  switch (n.kind) {
    case "session_published": {
      const count = Number(n.payload.count ?? 1);
      if (count > 1) return `${count} nouvelles séances${forAthlete}, du ${day(n.payload.date)} au ${day(n.payload.last_date)}`;
      return `Nouvelle séance${forAthlete} : « ${title} », ${day(n.payload.date)}`;
    }
    case "session_updated":
      if (n.payload.previous_date) return `Séance déplacée${forAthlete} : « ${title} », du ${day(n.payload.previous_date)} au ${day(n.payload.date)}`;
      return `Séance modifiée${forAthlete} : « ${title} », ${day(n.payload.date)}`;
    case "session_cancelled":
      return `Séance annulée${forAthlete} : « ${title} », ${day(n.payload.date)}`;
    case "comment":
      return `${n.actor_name ?? "Quelqu’un"} a commenté « ${title} » : ${text(n.payload.excerpt)}`;
    case "reconnect":
      return `Reconnectez ${PROVIDERS[text(n.payload.provider)] ?? "votre compte"} : l’accès a expiré ou a été retiré.`;
    case "export_failed":
      return `Export ${PROVIDERS[text(n.payload.provider)] ?? ""} impossible pour ${n.athlete_name ?? "un athlète"} : « ${title} ». ${text(n.payload.error)}`;
    case "missing_feedback":
      return `Comment s’est passée « ${title} » (${day(n.payload.date)}) ? Donnez votre retour.`;
  }
}

/** Page à ouvrir : la séance dans le bon calendrier, ou le profil pour Strava. */
export function notificationTarget(n: NotificationItem, viewerId: string): string {
  if (n.kind === "reconnect") return "/athlete/profile#connexions";
  const own = !n.athlete_id || n.athlete_id === viewerId;
  const params = new URLSearchParams({ view: own && n.session_id ? "day" : "week" });
  const date = text(n.payload.date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set("date", date);
  if (n.session_id) params.set("session", n.session_id);
  return `${own ? "/athlete/calendar" : `/coach/athletes/${n.athlete_id}`}?${params.toString()}`;
}
