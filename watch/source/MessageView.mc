import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Écran de texte simple (aide, erreur, confirmation), centré et coupé à la largeur de l'écran.
class MessageView extends WatchUi.View {
  var text;

  function initialize(message) {
    View.initialize();
    text = message;
  }

  function setText(message) {
    text = message;
    WatchUi.requestUpdate();
  }

  function onUpdate(dc) {
    Screen.clear(dc);
    Screen.drawCentered(dc, text, Graphics.FONT_SMALL);
  }
}

// Retour : comportement de la montre (ferme l'écran ouvert par-dessus, ou l'application depuis son
// premier écran). Jamais de popView ici : il est refusé sur le premier écran d'un widget.
class MessageDelegate extends WatchUi.BehaviorDelegate {
  function initialize() {
    BehaviorDelegate.initialize();
  }
}

// Mise en page partagée : texte coupé pour tenir dans la zone utile (écrans ronds compris).
module Screen {
  function clear(dc) {
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
    dc.clear();
  }

  function drawCentered(dc, text, font) {
    drawArea(dc, text, font, dc.getHeight() / 2, (dc.getHeight() * 0.8).toNumber());
  }

  // Texte centré sur la hauteur y, dans une zone de 82 % de la largeur et de la hauteur donnée.
  function drawArea(dc, text, font, y, height) {
    var shown = text;
    if (Graphics has :fitTextToArea) {
      shown = Graphics.fitTextToArea(text, font, (dc.getWidth() * 0.82).toNumber(), height, true);
    }
    dc.drawText(dc.getWidth() / 2, y, font, shown, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
  }
}
