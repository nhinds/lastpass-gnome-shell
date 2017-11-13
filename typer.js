// vim: ts=2:sw=2:et
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Lang = imports.lang;

// Delay between each keydown/keyup/keydown/... event
const DELAY_BETWEEN_HALF_KEYSTROKES = 8;

class Typer {
  constructor() {
    let deviceManager = Clutter.DeviceManager.get_default();
    this._virtualKeyboard = deviceManager.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  }

  type(str, callback) {
    let actions = [];
    for (let chr of str) {
        let codePoint = chr.codePointAt(0); // FIXME Maybe not a sensible thing to do for all unicode?
        let keyVal = Gdk.unicode_to_keyval(codePoint);
        actions.push(
            { keyVal: keyVal, state: Clutter.KeyState.PRESSED },
            { keyVal: keyVal, state: Clutter.KeyState.RELEASED }
        );
    }
    if (actions.length > 0) {
       GLib.timeout_add(GLib.PRIORITY_DEFAULT, DELAY_BETWEEN_HALF_KEYSTROKES, Lang.bind(this, function() {
         let action = actions.shift();
         this._virtualKeyboard.notify_keyval(Clutter.CURRENT_TIME, action.keyVal, action.state);

         if (actions.length > 0) {
           return GLib.SOURCE_CONTINUE;
         } else {
           callback();
           return GLib.SOURCE_REMOVE;
         }
       }));
    } else {
      callback();
    }
  }
}
