import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

// Association : la montre demande un code à TriCoach et l'affiche ; l'athlète le saisit dans son
// profil (Profil sportif, Montre Garmin) ; la montre reçoit alors son jeton, une seule fois.
class PairView extends WatchUi.View {
  var code = null;
  var deviceCode = null;
  var status;
  var timer = null;
  var interval = 5000;

  function initialize() {
    View.initialize();
    status = WatchUi.loadResource(Rez.Strings.PairRequesting);
  }

  function onShow() {
    if (deviceCode == null) {
      requestCode();
    } else {
      startPolling();
    }
  }

  function onHide() {
    stopPolling();
  }

  function requestCode() {
    stopPolling();
    code = null;
    deviceCode = null;
    status = WatchUi.loadResource(Rez.Strings.PairRequesting);
    WatchUi.requestUpdate();
    Api.postJson("/api/watch/pair", { "device" => Config.DEVICE_NAME }, method(:onCode));
  }

  function onCode(responseCode, data) {
    if (responseCode != 200 || !(data instanceof Dictionary)) {
      status = Api.errorText(responseCode) + "\n" + WatchUi.loadResource(Rez.Strings.PressToRetry);
      WatchUi.requestUpdate();
      return;
    }
    if (!"ok".equals(data["status"])) {
      status = WatchUi.loadResource(Rez.Strings.Unavailable);
      WatchUi.requestUpdate();
      return;
    }
    code = data["display"];
    deviceCode = data["deviceCode"];
    var seconds = data["interval"];
    if (seconds instanceof Number && seconds > 0) {
      interval = seconds * 1000;
    }
    status = WatchUi.loadResource(Rez.Strings.PairWaiting);
    WatchUi.requestUpdate();
    startPolling();
  }

  function startPolling() {
    if (timer == null && deviceCode != null) {
      timer = new Timer.Timer();
      timer.start(method(:poll), interval, true);
    }
  }

  function stopPolling() {
    if (timer != null) {
      timer.stop();
      timer = null;
    }
  }

  function poll() {
    Api.postJson("/api/watch/token", { "deviceCode" => deviceCode }, method(:onToken));
  }

  function onToken(responseCode, data) {
    // Réseau indisponible : nouvel essai au tour suivant.
    if (responseCode != 200 || !(data instanceof Dictionary)) {
      return;
    }
    var result = data["status"];
    if ("ready".equals(result) && data["token"] instanceof String) {
      stopPolling();
      Store.setToken(data["token"]);
      Checks.start();
      var loading = new LoadingView();
      WatchUi.switchToView(loading, new LoadingDelegate(loading), WatchUi.SLIDE_LEFT);
    } else if ("expired".equals(result) || "unknown".equals(result) || "claimed".equals(result)) {
      // Code périmé (10 minutes) : on en demande un autre.
      requestCode();
    }
  }

  function onUpdate(dc) {
    Screen.clear(dc);
    var height = dc.getHeight();
    Screen.drawArea(dc, WatchUi.loadResource(Rez.Strings.PairHelp), Graphics.FONT_XTINY, (height * 0.25).toNumber(), (height * 0.3).toNumber());
    if (code != null) {
      dc.drawText(dc.getWidth() / 2, height / 2, Graphics.FONT_MEDIUM, code, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
    Screen.drawArea(dc, status, Graphics.FONT_XTINY, (height * 0.75).toNumber(), (height * 0.3).toNumber());
  }
}

class PairDelegate extends WatchUi.BehaviorDelegate {
  var view;

  function initialize(pairing) {
    BehaviorDelegate.initialize();
    view = pairing;
  }

  // Après une erreur, le bouton de sélection redemande un code.
  function onSelect() {
    if (view.code == null) {
      view.requestCode();
    }
    return true;
  }
}
