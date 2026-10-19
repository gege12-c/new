import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Accueil : la prochaine séance. Si elle n'est pas encore sur la montre (nouvelle, ou modifiée par
// le coach) et qu'elle tient en une partie, elle se charge d'elle-même ; le bouton de sélection
// ouvre la liste des 7 prochains jours.
class HomeView extends WatchUi.View {
  var sessions;
  var autoChecked = false;
  var visible = false;
  var timer = null;

  function initialize(list) {
    View.initialize();
    sessions = list;
  }

  function onShow() {
    visible = true;
    if (autoChecked) {
      return;
    }
    autoChecked = true;
    // Pas sur les montres où l'appli défile parmi les widgets : un simple passage la lancerait.
    var settings = System.getDeviceSettings();
    var opened = (settings has :isGlanceModeEnabled) && settings.isGlanceModeEnabled;
    if (opened && Sessions.autoLoadable(first())) {
      // Laisser l'écran s'afficher avant d'ouvrir le chargement.
      timer = new Timer.Timer();
      timer.start(method(:autoLoad), 300, false);
    }
  }

  function onHide() {
    visible = false;
  }

  function autoLoad() as Void {
    var session = first();
    if (visible && session != null) {
      Load.start(session, session["parts"][0]);
    }
  }

  function first() {
    return sessions.size() > 0 ? sessions[0] : null;
  }

  function onUpdate(dc) {
    Screen.clear(dc);
    var session = first();
    if (session == null) {
      Screen.drawCentered(dc, WatchUi.loadResource(Rez.Strings.NoSession) + "\n" + WatchUi.loadResource(Rez.Strings.NoSessionSub), Graphics.FONT_SMALL);
      return;
    }
    var height = dc.getHeight();
    var center = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
    var x = dc.getWidth() / 2;
    dc.drawText(x, (height * 0.2).toNumber(), Graphics.FONT_XTINY, session["day"], center);
    Screen.drawArea(dc, session["title"], Graphics.FONT_SMALL, (height * 0.42).toNumber(), (height * 0.3).toNumber());
    var detail = Sessions.isLoaded(session) ? WatchUi.loadResource(Rez.Strings.OnWatch) : Sessions.duration(session["durationS"]);
    if (detail != null) {
      dc.drawText(x, (height * 0.63).toNumber(), Graphics.FONT_XTINY, detail, center);
    }
    Screen.drawArea(dc, WatchUi.loadResource(Rez.Strings.HomeHint), Graphics.FONT_XTINY, (height * 0.8).toNumber(), (height * 0.16).toNumber());
  }
}

class HomeDelegate extends WatchUi.BehaviorDelegate {
  var view;

  function initialize(home) {
    BehaviorDelegate.initialize();
    view = home;
  }

  function onSelect() {
    if (view.sessions.size() > 0) {
      WatchUi.pushView(Sessions.menu(view.sessions), new SessionsDelegate(view.sessions), WatchUi.SLIDE_LEFT);
    }
    return true;
  }
}
