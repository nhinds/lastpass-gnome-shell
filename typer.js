// vim: ts=2:sw=2:et
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Signals = imports.signals;

// Delay between each keydown/keyup/keydown/... event
const DELAY_BETWEEN_HALF_KEYSTROKES = 8;

var Typer = class Typer {
  constructor() {
    let deviceManager = Clutter.DeviceManager.get_default();
    this._virtualKeyboard = deviceManager.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);

    if (this._isX11()) {
      this._keymap = Gdk.Keymap.get_default(); // FIXME Are multiple keymaps possible / desired?
      this._notifyKeyval = this._notifyKeyvalX11;
    } else {
      this._notifyKeyval = this._notifyKeyvalNative;
    }
  }

  type(str) {
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
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, DELAY_BETWEEN_HALF_KEYSTROKES, () => {
        let action = actions.shift();
        this._notifyKeyval(action.keyVal, action.state);

        if (actions.length > 0) {
          return GLib.SOURCE_CONTINUE;
        } else {
          this.emit('finished');
          return GLib.SOURCE_REMOVE;
        }
      });
    } else {
      this.emit('finished');
    }
  }

  _isX11() {
    return this._virtualKeyboard.constructor.name.endsWith('X11');
  }

  _notifyKeyvalNative(keyVal, state) {
    this._virtualKeyboard.notify_keyval(Clutter.CURRENT_TIME, keyVal, state);
  }

  // In an ideal world, I would call _virtualKeyboard.notify_keyval and get the same behaviour
  // on X11 as on Wayland. Unfortunately the X11 implementation does not handle modifiers, so
  // is incapable of typing uppercase letters or characters requiring Shift.
  // This is a reimplementation of clutter_virtual_input_device_evdev_notify_keyval.
  _notifyKeyvalX11(keyVal, state) {
    let key = this._findKey(keyVal);

    if (state == Clutter.KeyState.PRESSED) {
      this._notifyModifiers(key.level, state);
    }

    this._virtualKeyboard.notify_key(Clutter.CURRENT_TIME, key.keycode, state);

    if (state == Clutter.KeyState.RELEASED) {
      this._notifyModifiers(key.level, state);
    }
  }

  _notifyModifiers(level, state) {
    let keyVal;
    switch (level) {
      case 0:
        return;
      case 1:
        keyVal = Clutter.KEY_Shift_L;
        break;
      case 2:
        keyVal = Clutter.KEY_ISO_Level3_Shift;
        break;
      default:
        throw new Error(`Don't know how to type modifier for level=${level}`);
    }
    let key = this._findKey(keyVal);
    if (key.level > 0) throw new Error(`Key for level=${level} needs another level modifier`);
    this._virtualKeyboard.notify_key(Clutter.CURRENT_TIME, key.keycode, state);
  }

  _findKey(keyVal) {
    let success, keys;
    [success, keys] = this._keymap.get_entries_for_keyval(keyVal);
    if (!success) throw new Error(`Don't know how to type key for keyVal=${keyVal}`)
    return keys[0]; // FIXME should check if this key is in the current "group", but don't know how to check that
  }
}
Signals.addSignalMethods(Typer.prototype)
