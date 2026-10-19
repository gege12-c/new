import Toybox.Application;
import Toybox.Lang;

// Mémoire de l'application, lue aussi par la vue rapide (glance) et par la tâche de fond.
// Le jeton de la montre ne donne accès qu'aux séances publiées des 7 prochains jours de l'athlète.
(:glance, :background)
module Store {
  const TOKEN_KEY = "token";
  const NEXT_KEY = "next";
  const LOADED_KEY = "loaded";
  const PROMPTED_KEY = "prompted";

  function token() {
    return Application.Storage.getValue(TOKEN_KEY);
  }

  // Jeton nul : la montre est dissociée, tout ce qui venait de TriCoach est oublié.
  function setToken(value) {
    if (value == null) {
      Application.Storage.clearValues();
    } else {
      Application.Storage.setValue(TOKEN_KEY, value);
    }
  }

  // Prochaine séance { dayNumber, day, title } pour la vue rapide.
  function next() {
    return Application.Storage.getValue(NEXT_KEY);
  }

  function setNext(value) {
    write(NEXT_KEY, value);
  }

  // « identifiant:version » de la dernière séance chargée sur la montre.
  function loaded() {
    return Application.Storage.getValue(LOADED_KEY);
  }

  function setLoaded(value) {
    write(LOADED_KEY, value);
  }

  // Séance déjà proposée par la tâche de fond : pas de nouvelle demande pour la même version.
  function prompted() {
    return Application.Storage.getValue(PROMPTED_KEY);
  }

  function setPrompted(value) {
    write(PROMPTED_KEY, value);
  }

  // Écriture tolérée en tâche de fond : refusée par les montres d'avant Connect IQ 3.2.
  function write(key, value) {
    try {
      if (value == null) {
        Application.Storage.deleteValue(key);
      } else {
        Application.Storage.setValue(key, value);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}
