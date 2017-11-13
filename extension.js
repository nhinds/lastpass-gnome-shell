// vim: ts=2:sw=2:et
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Typer = Me.imports.typer.Typer;

const ICON_NAME = 'channel-secure-symbolic';
// Pause between button click and trying to type the string
const INITIAL_PAUSE = 500;

class LastPassButton extends PanelMenu.Button {
  constructor() {
    super(St.Align.START, 'LastPass');

    let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
    this.icon = new St.Icon({ icon_name: ICON_NAME, style_class: 'system-status-icon lastpass-icon' });
    hbox.add_child(this.icon);
    this.actor.add_actor(hbox);

    this.typer = new Typer();

    this._createMenu();
  }

  _createMenu() {
    this.menu.addAction('Test', Lang.bind(this, function() {
      this.icon.add_style_class_name('lastpass-typing');
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, INITIAL_PAUSE, Lang.bind(this, function() {
        this.typer.type('Test', Lang.bind(this, function() {
          this.icon.remove_style_class_name('lastpass-typing');
        }));
        return GLib.SOURCE_REMOVE;
      }));
    }));
  }
}

let lastPassButton;
function enable() {
  lastPassButton = new LastPassButton();
  Main.panel.addToStatusArea('lastPassButton', lastPassButton);
}

function disable() {
  lastPassButton.destroy();
  lastPassButton = null;
}
