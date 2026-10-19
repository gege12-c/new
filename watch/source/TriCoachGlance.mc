import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

// Vue rapide : la prochaine séance, sans réseau (gardée à jour par la tâche de fond sur les
// montres récentes, sinon à chaque ouverture de TriCoach). Une séance passée n'est pas montrée.
(:glance)
class TriCoachGlance extends WatchUi.GlanceView {
  function initialize() {
    GlanceView.initialize();
  }

  // Date en nombre AAAAMMJJ, comme TriCoach l'envoie : on compare des nombres.
  function dayNumber(moment) {
    var info = Gregorian.info(moment, Time.FORMAT_SHORT);
    return info.year * 10000 + info.month * 100 + info.day;
  }

  function line() {
    var next = Store.next();
    if (!(next instanceof Dictionary) || !(next["dayNumber"] instanceof Number)) {
      return WatchUi.loadResource(Rez.Strings.GlanceEmpty);
    }
    var date = next["dayNumber"];
    var today = dayNumber(Time.today());
    // Midi le lendemain : la bonne date même les jours de changement d'heure.
    var tomorrow = dayNumber(Time.today().add(new Time.Duration(36 * 3600)));
    var day;
    if (date < today) {
      return WatchUi.loadResource(Rez.Strings.GlanceEmpty);
    } else if (date == today) {
      day = WatchUi.loadResource(Rez.Strings.GlanceToday);
    } else if (date == tomorrow) {
      day = WatchUi.loadResource(Rez.Strings.GlanceTomorrow);
    } else {
      day = next["day"];
    }
    return day + " : " + next["title"];
  }

  function onUpdate(dc) {
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    var left = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
    dc.drawText(0, dc.getHeight() / 4, Graphics.FONT_TINY, WatchUi.loadResource(Rez.Strings.AppName), left);
    dc.drawText(0, (dc.getHeight() * 3) / 4, Graphics.FONT_XTINY, line(), left);
  }
}
