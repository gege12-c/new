import Toybox.Communications;
import Toybox.Lang;
import Toybox.WatchUi;

// Appels au serveur TriCoach, par le téléphone (application Garmin Connect).
module Api {
  function postJson(path, body, callback) {
    Communications.makeWebRequest(
      Config.SERVER_URL + path,
      body,
      {
        :method => Communications.HTTP_REQUEST_METHOD_POST,
        :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
        :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
      },
      callback
    );
  }

  function getSessions(callback) {
    Communications.makeWebRequest(
      Config.SERVER_URL + "/api/watch/sessions",
      null,
      {
        :method => Communications.HTTP_REQUEST_METHOD_GET,
        :headers => { "Authorization" => "Bearer " + Store.token() },
        :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
      },
      callback
    );
  }

  // Fichier FIT de séance : la montre l'enregistre dans ses entraînements (PersistedContent).
  // Pas d'en-tête Content-Type sur cette requête : certaines montres échouent sinon.
  function downloadWorkout(sessionId, part, callback) {
    Communications.makeWebRequest(
      Config.SERVER_URL + "/api/watch/sessions/" + sessionId + "/fit",
      { "part" => part },
      {
        :method => Communications.HTTP_REQUEST_METHOD_GET,
        :headers => { "Authorization" => "Bearer " + Store.token() },
        :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_FIT,
      },
      callback
    );
  }

  // Message lisible pour un code de réponse (réseau, serveur, mémoire de la montre).
  function errorText(code) {
    if (code == Communications.STORAGE_FULL) {
      return WatchUi.loadResource(Rez.Strings.StorageFull);
    }
    return Lang.format(WatchUi.loadResource(Rez.Strings.NetworkError), [code]);
  }
}
