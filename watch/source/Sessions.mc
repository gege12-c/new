import Toybox.Lang;
import Toybox.WatchUi;

// Liste des séances, puis choix de la partie d'un enchaînement (une séance Garmin par partie).
module Sessions {
  // « identifiant:version » : change à chaque modification de la séance par le coach.
  function key(session) {
    return session["id"] + ":" + session["version"];
  }

  function isLoaded(session) {
    return key(session).equals(Store.loaded());
  }

  // Chargement automatique à l'ouverture : une seule partie, convertible, pas encore sur la montre.
  function autoLoadable(session) {
    if (session == null || !(Toybox has :PersistedContent) || isLoaded(session)) {
      return false;
    }
    var parts = session["parts"];
    return parts instanceof Array && parts.size() == 1 && parts[0]["ok"] == true;
  }

  function menu(sessions) {
    var list = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.AppName) });
    for (var i = 0; i < sessions.size(); i += 1) {
      var session = sessions[i];
      list.addItem(new WatchUi.MenuItem(session["title"], subLabel(session), i, {}));
    }
    return list;
  }

  // « Demain, 1 h 10 », ou « Demain, sur la montre ».
  function subLabel(session) {
    var label = session["day"];
    if (isLoaded(session)) {
      return label + ", " + WatchUi.loadResource(Rez.Strings.OnWatchShort);
    }
    var length = duration(session["durationS"]);
    return length == null ? label : label + ", " + length;
  }

  function duration(seconds) {
    if (!(seconds instanceof Number) || seconds <= 0) {
      return null;
    }
    var minutes = (seconds + 30) / 60;
    if (minutes < 60) {
      return minutes.format("%d") + " min";
    }
    return (minutes / 60).format("%d") + " h " + (minutes % 60).format("%02d");
  }

  function sportLabel(sport) {
    if ("bike".equals(sport)) {
      return "Vélo";
    }
    if ("run".equals(sport)) {
      return "Course à pied";
    }
    if ("swim".equals(sport)) {
      return "Natation";
    }
    if ("strength".equals(sport)) {
      return "Renforcement";
    }
    return "Autre";
  }
}

class SessionsDelegate extends WatchUi.Menu2InputDelegate {
  var sessions;

  function initialize(list) {
    Menu2InputDelegate.initialize();
    sessions = list;
  }

  function onSelect(item) {
    var index = item.getId();
    if (!(index instanceof Number) || index < 0 || index >= sessions.size()) {
      return;
    }
    var session = sessions[index];
    var parts = session["parts"];
    if (!(parts instanceof Array) || parts.size() == 0) {
      Load.showMessage(WatchUi.loadResource(Rez.Strings.NotDownloadable));
      return;
    }
    if (parts.size() == 1) {
      Load.start(session, parts[0]);
      return;
    }
    var choices = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.PartsTitle) });
    for (var i = 0; i < parts.size(); i += 1) {
      var part = parts[i];
      choices.addItem(new WatchUi.MenuItem(Sessions.sportLabel(part["sport"]), part["ok"] == true ? null : part["reason"], i, {}));
    }
    WatchUi.pushView(choices, new PartsDelegate(session), WatchUi.SLIDE_LEFT);
  }

  function onBack() {
    WatchUi.popView(WatchUi.SLIDE_RIGHT);
  }
}

class PartsDelegate extends WatchUi.Menu2InputDelegate {
  var session;

  function initialize(chosen) {
    Menu2InputDelegate.initialize();
    session = chosen;
  }

  function onSelect(item) {
    var index = item.getId();
    var parts = session["parts"];
    if (index instanceof Number && parts instanceof Array && index >= 0 && index < parts.size()) {
      Load.start(session, parts[index]);
    }
  }

  function onBack() {
    WatchUi.popView(WatchUi.SLIDE_RIGHT);
  }
}
