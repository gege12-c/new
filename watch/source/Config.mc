// Adresse de TriCoach et nom donné à la montre lors de l'association (visible dans le profil).
(:glance, :background)
module Config {
  const SERVER_URL = "https://new-bay-one-76.vercel.app";
  const DEVICE_NAME = "Montre Garmin";
  // Vérification en tâche de fond : toutes les 30 minutes, entre 7 h et 21 h, hors « ne pas déranger ».
  const CHECK_EVERY_S = 1800;
  const PROMPT_FROM_HOUR = 7;
  const PROMPT_UNTIL_HOUR = 21;
}
