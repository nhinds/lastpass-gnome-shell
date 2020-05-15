declare const imports: any;

const { GObject, St, Clutter, GLib, Gio, Meta, Pango, Shell } = imports.gi;

const Dialog = imports.ui.dialog;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PanelMenu = imports.ui.panelMenu;
const Params = imports.misc.params;
const PopupMenu = imports.ui.popupMenu;
const ShellEntry = imports.ui.shellEntry;
const Signals = imports.signals;

const ExtensionUtils = imports.misc.extensionUtils;
const Convenience = Me.imports.convenience;
const Typer = Me.imports.typer.Typer;

export class ModalLoginDialog extends ModalDialog.ModalDialog {
  static async prompt(params) {
    let dialog = new ModalLoginDialog(params);
    return new Promise((resolve, reject) => {
      dialog.connect('login', (_dialog, username, password, rememberPassword) => {
        resolve({ username: username, password: password, remember: rememberPassword });
      });
      dialog.connect('cancelled', () => reject(new Error('Cancelled')));
    });
  }


  /* params={ initialUsername:String, errorMessage:String or `false` for no error, reprompt:Boolean } */
  constructor(params) {
    super({ styleClass: 'prompt-dialog' });
    params = Params.parse(params, { initialUsername: '', errorMessage: false, reprompt: false });
    this._reprompt = params.reprompt;

    let contentParams = {
      icon: new Gio.ThemedIcon({ name: ICON_NAME }),
      title: this._reprompt ? 'LastPass Password Reprompt' : 'LastPass Login'
    };
    if (params.errorMessage !== false) {
      contentParams.body = params.errorMessage;
    }
    this._content = new Dialog.MessageDialogContent(contentParams);
    this.contentLayout.add(this._content);

    let grid = new Clutter.GridLayout({ orientation: Clutter.Orientation.VERTICAL });
    let loginTable = new St.Widget({ style_class: 'lastpass-login-dialog-table', layout_manager: grid });
    grid.hookup_style(loginTable);

    let row = 0;
    if (!this._reprompt) {
      let usernameLabel = new St.Label({
        style_class: 'lastpass-login-dialog-username-label',
        text: 'Username',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER
      });
      usernameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
      grid.attach(usernameLabel, 0, row, 1, 1);

      this._usernameEntry = new St.Entry({
        style_class: 'lastpass-login-dialog-username-entry',
        text: params.initialUsername,
        can_focus: true,
        reactive: true,
        x_expand: true
      });
      this._usernameEntry.clutter_text.connect('text-changed', () => this._updateLoginButton());
      this._usernameEntry.clutter_text.connect('activate', () => this._passwordEntry.grab_key_focus());
      // Adds copy/paste menu and sets the entry purpose
      ShellEntry.addContextMenu(this._usernameEntry);
      grid.attach(this._usernameEntry, 1, row, 1, 1);

      row++;
    }

    let passwordLabel = new St.Label({
      style_class: 'lastpass-login-dialog-password-label',
      text: 'Password',
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER
    });
    passwordLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    grid.attach(passwordLabel, 0, row, 1, 1);

    this._passwordEntry = new St.Entry({
      style_class: 'lastpass-login-dialog-password-entry',
      text: '',
      can_focus: true,
      reactive: true,
      x_expand: true
    });
    this._passwordEntry.clutter_text.connect('text-changed', () => this._updateLoginButton());
    this._passwordEntry.clutter_text.connect('activate', () => this._doneLogin());
    // Hide typing. Matches the character used by the ShellEntry.addContextMenu menu
    this._passwordEntry.clutter_text.set_password_char('\u25cf');
    // Adds copy/paste/"show text" menu and sets the entry purpose
    ShellEntry.addContextMenu(this._passwordEntry, { isPassword: true });
    grid.attach(this._passwordEntry, 1, row, 1, 1);

    row++;

    // TODO "remember" checkbox

    this._content.messageBox.add(loginTable);

    this.addButton({
      label: 'Cancel',
      key: Clutter.Escape,
      action: () => this._cancelLogin()
    });
    this._loginButton = this.addButton({
      label: 'Login',
      default: true,
      action: () => this._doneLogin()
    });

    this._updateLoginButton();
    this.setInitialKeyFocus(this._reprompt || params.initialUsername.length > 0 ? this._passwordEntry : this._usernameEntry);

    let sessionModeSignalId = Main.sessionMode.connect('updated', () => {
      if (!Main.sessionMode.isLocked)
        return;

      this._cancelLogin();
    });
    this.connect('closed', () => Main.sessionMode.disconnect(sessionModeSignalId));

    this.open();
  }

  _isLoginValid() {
    return (this._reprompt || this._usernameEntry.get_text().length > 0) && this._passwordEntry.get_text().length > 0;
  }

  _updateLoginButton() {
    this._loginButton.reactive = this._loginButton.can_focus = this._isLoginValid();
  }

  _cancelLogin() {
    this.close();
    this.emit('cancelled');
  }

  _doneLogin() {
    if (!this._isLoginValid()) {
      return;
    }

    this.close();
    this.emit('login', this._reprompt ? '' : this._usernameEntry.get_text(), this._passwordEntry.get_text(), false); // TODO "remember" functionality
  }
}