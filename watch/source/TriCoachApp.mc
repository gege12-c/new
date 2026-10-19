import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// TriCoach pour montre Garmin : association par code, puis séances des 7 prochains jours,
// chargées en séances Garmin et lancées par la montre elle-même (ses écrans, ses alertes).
// La classe de l'application est chargée aussi par la vue rapide et par la tâche de fond : elle
// ne contient que des renvois, la logique des écrans est dans le module Start.
(:glance, :background)
class TriCoachApp extends Application.AppBase {
  function initialize() {
    AppBase.initialize();
  }

  function getServiceDelegate() {
    return [new TriCoachService()];
  }

  function getGlanceView() {
    return [new TriCoachGlance()];
  }

  function getInitialView() {
    return Start.initialView();
  }

  // Séance proposée par la tâche de fond (montres qui n'écrivent pas en tâche de fond).
  function onBackgroundData(data) {
    if (data instanceof Dictionary && data["prompted"] != null) {
      Store.setPrompted(data["prompted"]);
    }
  }
}

// Premier écran : association si la montre n'a pas de jeton, sinon chargement des séances.
module Start {
  function initialView() {
    var connected = System.getDeviceSettings().phoneConnected;
    if (Store.token() == null) {
      Checks.stop();
      if (!connected) {
        return [new MessageView(WatchUi.loadResource(Rez.Strings.NoPhone)), new MessageDelegate()];
      }
      var pairing = new PairView();
      return [pairing, new PairDelegate(pairing)];
    }
    Checks.start();
    if (!connected) {
      return [new MessageView(WatchUi.loadResource(Rez.Strings.NoPhone)), new MessageDelegate()];
    }
    var loading = new LoadingView();
    return [loading, new LoadingDelegate(loading)];
  }
}

// Vérification en tâche de fond toutes les 30 minutes, tant que la montre est associée.
module Checks {
  function start() {
    if ((Toybox has :Background) && Background.getTemporalEventRegisteredTime() == null) {
      Background.registerForTemporalEvent(new Time.Duration(Config.CHECK_EVERY_S));
    }
  }

  function stop() {
    if (Toybox has :Background) {
      Background.deleteTemporalEvent();
    }
  }
}
