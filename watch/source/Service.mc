import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

// Tâche de fond, toutes les 30 minutes, par le téléphone : si la prochaine séance n'est pas encore
// sur la montre (nouvelle, ou modifiée par le coach), la montre propose d'ouvrir TriCoach pour la
// charger. Garmin n'autorise pas l'enregistrement d'une séance en tâche de fond : l'appli doit
// être ouverte, d'où la demande. Une seule demande par version de séance, en journée seulement.
(:background)
class TriCoachService extends System.ServiceDelegate {
  function initialize() {
    ServiceDelegate.initialize();
  }

  function onTemporalEvent() {
    var token = Store.token();
    if (token == null) {
      Background.exit(null);
      return;
    }
    try {
      Communications.makeWebRequest(
        Config.SERVER_URL + "/api/watch/changes",
        null,
        {
          :method => Communications.HTTP_REQUEST_METHOD_GET,
          :headers => { "Authorization" => "Bearer " + token },
          :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        },
        method(:onChanges)
      );
    } catch (e) {
      Background.exit(null);
    }
  }

  function onChanges(responseCode, data) {
    if (responseCode != 200 || !(data instanceof Dictionary) || !"ok".equals(data["status"])) {
      Background.exit(null);
      return;
    }
    var next = data["next"];
    if (!(next instanceof Dictionary)) {
      Background.exit(null);
      return;
    }
    Store.setNext({ "dayNumber" => next["dayNumber"], "day" => next["day"], "title" => next["title"] });

    var key = next["key"];
    if (next["ready"] != true || key == null || key.equals(Store.loaded()) || key.equals(alreadyPrompted())) {
      Background.exit(null);
      return;
    }
    var hour = System.getClockTime().hour;
    var settings = System.getDeviceSettings();
    var quiet = (settings has :doNotDisturb) && settings.doNotDisturb;
    if (quiet || hour < Config.PROMPT_FROM_HOUR || hour >= Config.PROMPT_UNTIL_HOUR) {
      Background.exit(null);
      return;
    }
    Store.setPrompted(key);
    Background.requestApplicationWake("TriCoach : séance à charger\n" + next["day"] + " : " + next["title"]);
    // La version proposée part aussi à l'application, pour les montres qui n'écrivent pas en tâche de fond.
    Background.exit({ "prompted" => key });
  }

  // Version déjà proposée : enregistrée par la tâche de fond, ou en attente pour l'application.
  function alreadyPrompted() {
    var pending = Background.getBackgroundData();
    if (pending instanceof Dictionary && pending["prompted"] != null) {
      return pending["prompted"];
    }
    return Store.prompted();
  }
}
