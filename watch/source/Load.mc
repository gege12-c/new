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
  var visible = false;
  var timer = null;
  var intent = null;

  function initialize(chosen, index) {
    View.initialize();
    session = chosen;
    part = index;
    text = WatchUi.loadResource(Rez.Strings.Downloading);
  }

  function onShow() {
    visible = true;
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

  function onHide() {
    visible = false;
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
        // Elle n'est plus sur la montre : ne plus le prétendre, et la reproposer si besoin.
        Store.setLoaded(null);
      }
      workout = workouts.next();
    }
  }

  function onTimeout() as Void {
    if (!answered) {
      finish(Api.errorText(Communications.NETWORK_REQUEST_TIMED_OUT));
    }
  }

  function stopTimer() {
    if (timer != null) {
      timer.stop();
      timer = null;
    }
  }

  function finish(message) {
    answered = true;
    stopTimer();
    text = message;
    WatchUi.requestUpdate();
  }

  function onWorkout(responseCode, data) {
    if (answered) {
      return;
    }
    var workouts = data instanceof PersistedContent.Iterator ? data : null;
    var workout = workouts == null ? null : workouts.next();
    if (responseCode == 200 && workout != null) {
      Store.setLoaded(Sessions.key(session));
      finish(WatchUi.loadResource(Rez.Strings.Saved));
      intent = workout.toIntent();
      // La montre demande elle-même s'il faut démarrer la séance ; seulement si cet écran est
      // encore affiché (pas après un retour pendant le téléchargement).
      if (visible) {
        timer = new Timer.Timer();
        timer.start(method(:launch), 300, false);
      }
      return;
    }
    if (responseCode == 401) {
      unpaired();
      return;
    }
    if (responseCode > 0 && responseCode != 200) {
      finish(Api.errorText(responseCode));
      return;
    }
    // Code 0, ou réponse sans séance : beaucoup de montres taisent la cause d'un échec de
    // téléchargement de fichier. TriCoach la dit : montre dissociée, séance modifiée, ou mémoire.
    stopTimer();
    timer = new Timer.Timer();
    timer.start(method(:onTimeout), Load.TIMEOUT_MS, false);
    text = WatchUi.loadResource(Rez.Strings.Checking);
    WatchUi.requestUpdate();
    Api.getSessions(method(:onCheck));
  }

  function onCheck(responseCode, data) {
    if (answered) {
      return;
    }
    if (responseCode != 200 || !(data instanceof Dictionary)) {
      finish(Api.errorText(responseCode));
      return;
    }
    if ("unauthorized".equals(data["status"])) {
      unpaired();
      return;
    }
    var sessions = data["sessions"];
    if (!"ok".equals(data["status"]) || !(sessions instanceof Array)) {
      finish(WatchUi.loadResource(Rez.Strings.Unavailable));
      return;
    }
    var wanted = Sessions.key(session);
    for (var i = 0; i < sessions.size(); i += 1) {
      if (wanted.equals(Sessions.key(sessions[i]))) {
        finish(WatchUi.loadResource(Rez.Strings.StorageFull));
        return;
      }
    }
    finish(WatchUi.loadResource(Rez.Strings.SessionChanged));
  }

  // Montre dissociée depuis TriCoach entre-temps.
  function unpaired() {
    Store.setToken(null);
    Checks.stop();
    finish(WatchUi.loadResource(Rez.Strings.Unauthorized));
  }

  // Lancement différé (la minuterie vit avec cet écran) : certaines montres refusent de quitter
  // l'application depuis un rappel. Si la montre refuse, la séance reste dans ses entraînements.
  function launch() as Void {
    timer = null;
    if (intent == null) {
      return;
    }
    try {
      System.exitTo(intent);
    } catch (e) {
      finish(WatchUi.loadResource(Rez.Strings.Saved));
    }
  }

  function onUpdate(dc) {
    Screen.clear(dc);
    Screen.drawCentered(dc, text, Graphics.FONT_SMALL);
  }
}
