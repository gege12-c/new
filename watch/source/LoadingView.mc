import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Chargement des séances d'aujourd'hui à J+6 ; puis l'accueil, ou l'association si la montre
// a été dissociée depuis TriCoach.
class LoadingView extends WatchUi.View {
  var text;
  var busy = false;
  var done = false;

  function initialize() {
    View.initialize();
    text = WatchUi.loadResource(Rez.Strings.Loading);
  }

  function onShow() {
    if (!done && !busy) {
      load();
    }
  }

  function load() {
    busy = true;
    text = WatchUi.loadResource(Rez.Strings.Loading);
    WatchUi.requestUpdate();
    Api.getSessions(method(:onSessions));
  }

  function onSessions(responseCode, data) {
    busy = false;
    if (responseCode != 200 || !(data instanceof Dictionary)) {
      text = Api.errorText(responseCode) + "\n" + WatchUi.loadResource(Rez.Strings.PressToRetry);
      WatchUi.requestUpdate();
      return;
    }
    var status = data["status"];
    if ("unauthorized".equals(status)) {
      done = true;
      Store.setToken(null);
      Checks.stop();
      var pairing = new PairView();
      WatchUi.switchToView(pairing, new PairDelegate(pairing), WatchUi.SLIDE_LEFT);
      return;
    }
    if (!"ok".equals(status) || !(data["sessions"] instanceof Array)) {
      text = WatchUi.loadResource(Rez.Strings.Unavailable);
      WatchUi.requestUpdate();
      return;
    }
    done = true;
    var sessions = data["sessions"];
    if (sessions.size() > 0) {
      var first = sessions[0];
      Store.setNext({ "dayNumber" => first["dayNumber"], "day" => first["day"], "title" => first["title"] });
    } else {
      Store.setNext(null);
    }
    var home = new HomeView(sessions);
    WatchUi.switchToView(home, new HomeDelegate(home), WatchUi.SLIDE_LEFT);
  }

  function onUpdate(dc) {
    Screen.clear(dc);
    Screen.drawCentered(dc, text, Graphics.FONT_SMALL);
  }
}

class LoadingDelegate extends WatchUi.BehaviorDelegate {
  var view;

  function initialize(loading) {
    BehaviorDelegate.initialize();
    view = loading;
  }

  // Après une erreur, le bouton de sélection relance le chargement.
  function onSelect() {
    if (!view.busy && !view.done) {
      view.load();
    }
    return true;
  }

  function onBack() {
    WatchUi.popView(WatchUi.SLIDE_RIGHT);
    return true;
  }
}
