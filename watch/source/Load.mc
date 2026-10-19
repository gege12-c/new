import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Téléchargement d'une séance en séance Garmin, puis lancement par la montre (ses écrans, ses
// alertes, ses cibles). Une seule séance TriCoach à la fois dans les entraînements de la montre.
module Load {
  const TIMEOUT_MS = 30000;

  function showMessage(text) {
    WatchUi.pushView(new MessageView(text), new MessageDelegate(), WatchUi.SLIDE_LEFT);
  }

  function start(session, part) {
    if (part["ok"] != true) {
      var reason = part["reason"];
      showMessage(WatchUi.loadResource(Rez.Strings.NotDownloadable) + (reason != null ? "\n" + reason : ""));
      return;
    }
    if (!(Toybox has :PersistedContent)) {
      showMessage(WatchUi.loadResource(Rez.Strings.NoDownload));
      return;
    }
    WatchUi.pushView(new DownloadView(session, part["index"]), new MessageDelegate(), WatchUi.SLIDE_LEFT);
  }
}

class DownloadView extends WatchUi.View {
  var session;
  var part;
  var text;
  var started = false;
  var answered = false;
  var timer = null;
  var intent = null;

  function initialize(chosen, index) {
    View.initialize();
    session = chosen;
    part = index;
    text = WatchUi.loadResource(Rez.Strings.Downloading);
  }

  function onShow() {
    if (started) {
      return;
    }
    started = true;
    clearPrevious();
    // Certaines montres ne rendent jamais la main : au-delà de 30 secondes, on le dit.
    timer = new Timer.Timer();
    timer.start(method(:onTimeout), Load.TIMEOUT_MS, false);
    try {
      Api.downloadWorkout(session["id"], part, method(:onWorkout));
    } catch (e) {
      finish(WatchUi.loadResource(Rez.Strings.NoDownload));
    }
  }

  // Les séances TriCoach déjà chargées sont retirées : la montre ne garde que la dernière.
  function clearPrevious() {
    if (!(PersistedContent has :getAppWorkouts)) {
      return;
    }
    var workouts = PersistedContent.getAppWorkouts();
    var workout = workouts.next();
    while (workout != null) {
      if (workout has :remove) {
        workout.remove();
      }
      workout = workouts.next();
    }
  }

  function onTimeout() {
    if (!answered) {
      finish(Api.errorText(Communications.NETWORK_REQUEST_TIMED_OUT));
    }
  }

  function finish(message) {
    answered = true;
    if (timer != null) {
      timer.stop();
      timer = null;
    }
    text = message;
    WatchUi.requestUpdate();
  }

  function onWorkout(responseCode, data) {
    if (answered) {
      return;
    }
    if (responseCode == 401) {
      // Montre dissociée depuis TriCoach entre-temps.
      Store.setToken(null);
      Checks.stop();
      finish(WatchUi.loadResource(Rez.Strings.Unauthorized));
      return;
    }
    var workouts = data instanceof PersistedContent.Iterator ? data : null;
    var workout = workouts == null ? null : workouts.next();
    if ((responseCode == 200 && workout == null) || responseCode == 0) {
      finish(WatchUi.loadResource(Rez.Strings.StorageFull));
      return;
    }
    if (responseCode != 200) {
      finish(Api.errorText(responseCode));
      return;
    }
    Store.setLoaded(Sessions.key(session));
    finish(WatchUi.loadResource(Rez.Strings.Saved));
    intent = workout.toIntent();
    WatchUi.pushView(new WatchUi.Confirmation(WatchUi.loadResource(Rez.Strings.StartNow)), new StartDelegate(self), WatchUi.SLIDE_UP);
  }

  // Lancement différé (la minuterie vit avec cet écran, qui reste dans la pile) : certaines
  // montres refusent de quitter l'application depuis un rappel.
  function startWorkout() {
    timer = new Timer.Timer();
    timer.start(method(:launch), 300, false);
  }

  function launch() {
    if (intent != null) {
      System.exitTo(intent);
    }
  }

  function onUpdate(dc) {
    Screen.clear(dc);
    Screen.drawCentered(dc, text, Graphics.FONT_SMALL);
  }
}

// « La démarrer ? » Oui : la montre ouvre la séance (écran de départ Garmin).
// Non : elle reste dans les entraînements de la montre, pour plus tard.
class StartDelegate extends WatchUi.ConfirmationDelegate {
  var view;

  function initialize(download) {
    ConfirmationDelegate.initialize();
    view = download;
  }

  function onResponse(response) {
    if (response == WatchUi.CONFIRM_YES) {
      view.startWorkout();
    }
    return true;
  }
}
