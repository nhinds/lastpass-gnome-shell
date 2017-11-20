// vim: ts=2:sw=2:et
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const St = imports.gi.St;

const Lang = imports.lang;
const Dialog = imports.ui.dialog;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PanelMenu = imports.ui.panelMenu;
const Params = imports.misc.params;
const PopupMenu = imports.ui.popupMenu;
const ShellEntry = imports.ui.shellEntry;
const Signals = imports.signals;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Typer = Me.imports.typer.Typer;
const LastPassClient = Me.imports.lastpass.client.LastPassClient;

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

    this._typer = new Typer();
    this._typer.connect('finished', () => this.icon.remove_style_class_name('lastpass-typing'));
    this._client = new LastPassClient();

    // TODO read from gsettings?
    this._favouriteAccounts = new Set();
    this._vault = null;
    this._accounts = null;

    this._createMenu();
  }

  _createMenu() {
    this.menu.actor.add_style_class_name('lastpass-menu');

    this.favouriteSection = new PopupMenu.PopupMenuSection();
    this.menu.addMenuItem(this.favouriteSection);
    this._createFavouriteMenuItems();

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this.otherSection = new PopupMenu.PopupMenuSection();
    this.menu.addMenuItem(this.otherSection);
    this._createOtherMenuItems();
  }

  _createFavouriteMenuItems() {
    let accounts = this._accounts;
    this.favouriteSection.removeAll();
    for (let accountName of this._favouriteAccounts) {
      let username = '';
      if (accounts != null && accounts.hasOwnProperty(accountName)) {
        username = accounts[accountName].username;
      }
      this._addAccountItem(this.favouriteSection, accountName, username);
    }
  }

  _createOtherMenuItems() {
    this.otherSection.removeAll();
    let otherAction = this.otherSection.addAction('Other Passwords...', () => {
      this._openVault(true).then(accounts => {
        this.otherSection.removeAll();
        this._otherExpandMenuItem = new PopupMenu.PopupSubMenuMenuItem('Other Passwords', false);
        this.otherSection.addMenuItem(this._otherExpandMenuItem);
        let otherMenu = this._otherExpandMenuItem.menu;

        let sortedAccountNames = Object.keys(accounts).sort();
        for (let accountName of sortedAccountNames) {
          let account = accounts[accountName];
          this._addAccountItem(otherMenu, accountName, account.username);
        }

        this.menu.open();
        otherMenu.open(false);

        // Paranoia: clear out the local variable `accounts` in case something has captured a closure of it
        accounts = null;
      }).catch(error => {
        print(`Could not open LastPass vault: ${error.message}`);
      });
    });
  }

  _addAccountItem(menu, accountName, username) {
    let accountItem = menu.addAction(this._getAccountDisplayName(accountName, username), () => {
      this._openVault(false).then(accounts => this._type(accounts[accountName].password)).catch(e => {
        print(`Error typing password: ${e.message}`);
      });
    });
    let iconName = this._isFavourited(accountName) ? 'starred-symbolic' : 'non-starred-symbolic';
    let favouriteIcon = new St.Icon({ icon_name: iconName, style_class: 'system-status-icon' });
    let favouriteButton = new St.Button({
      style_class: 'lastpass-favourite-button',
      x_fill: true,
      x_expand: true,
      y_expand: true,
      can_focus: true,
      child: favouriteIcon
    });
    // There are two x-align properties in the hierarchy of St.Button, and trying to set this in the constructor has tries to set the wrong one
    favouriteButton.set_x_align(Clutter.ActorAlign.END);
    favouriteButton.connect('clicked', () => {
      let currentlyFavourited = this._isFavourited(accountName);
      iconName = currentlyFavourited ? 'non-starred-symbolic' : 'starred-symbolic';
      favouriteIcon.icon_name = iconName;
      this._setFavourited(accountName, !currentlyFavourited);
    });
    favouriteButton.connect('enter-event', () => favouriteIcon.icon_name = 'semi-starred-symbolic');
    favouriteButton.connect('leave-event', () => favouriteIcon.icon_name = iconName);
    accountItem.actor.add_child(favouriteButton);
    return accountItem;
  }

  _isFavourited(accountName) {
    return this._favouriteAccounts.has(accountName);
  }

  _setFavourited(accountName, favourited) {
    // TODO save somewhere
    if (favourited) {
      this._favouriteAccounts.add(accountName);
    } else {
      this._favouriteAccounts.delete(accountName);
    }

    // FIXME it's kind of annoying to update the top menu section while clicking in the bottom section, maybe delay this until the next time the menu opens?
    this._createFavouriteMenuItems();
    // FIXME update the favourite icon in the 'other' section when the item is un-favourited in the main section. or stop people from doing that by hiding favourites in their own section that auto-opens?
  }

  async _openVault(cacheWhileMenuOpen, username = '', errorMessage = false) {
    let accounts = this._accounts;
    if (accounts != null) {
      return accounts;
    }
    let vault = this._vault;
    let credentials;
    if (vault == null) {
      // TODO retrieve last username from gsettings
      credentials = await ModalLoginDialog.prompt({ initialUsername: username, errorMessage: errorMessage });
      // TODO store last username in gsettings
      try {
        // TODO better feedback while logging in - keep the modal dialog open?
        vault = await this._client.getVault(credentials.username, credentials.password);
        this._vault = vault;
      } catch (e) {
        // retry from the start by reopening the login dialog
        return this._openVault(cacheWhileMenuOpen, credentials.username, e.message);
      }
    } else {
      credentials = await ModalLoginDialog.prompt({ errorMessage: errorMessage, reprompt: true })
    }
    try {
      accounts = await vault.open(credentials.password);
    } catch (e) {
      print(`Error opening vault: ${e.message}`);
      // retry from the start by reopening the reprompt dialog
      return this._openVault(cacheWhileMenuOpen, credentials.username, 'Error unlocking vault, invalid password?');
    }
    if (credentials.remember) { // TODO test this once the dialog can return this value
      this._accounts = accounts;
      // Clear after 5 minutes
      this._oneOffTimer(300000, () => this._clearAccounts());
    } else if (cacheWhileMenuOpen) {
      this._accounts = accounts;
      // Clear when the menu closes
      let listenerId = this.menu.connect('open-state-changed', (_menu, open) => {
        if (!open) {
          this.menu.disconnect(listenerId);
          // Clear the accounts when javascript is next idle, to allow any synchronous code following this callback to still retrieve this._accounts
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => this._clearAccounts());
        }
      });
    }
    return accounts;
  }

  _getAccountDisplayName(accountName, username) {
    if (username.length > 0) {
      return `${accountName} (${username})`;
    } else {
      return accountName;
    }
  }

  // Clears the cached unlocked accounts and the encrypted vault
  _clearVault() {
    this._clearAccounts();
    this._vault = null;
  }

  // Clears the cached unlocked accounts
  _clearAccounts() {
    if (this._accounts != null) {
      this._accounts = null;
      this._createOtherMenuItems();
    }
  }

  _type(text) {
    this.icon.add_style_class_name('lastpass-typing');

    this._oneOffTimer(INITIAL_PAUSE, () => this._typer.type(text));
  }

  _oneOffTimer(pause, callback) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, pause, () => {
      callback();
      return GLib.SOURCE_REMOVE;
    });
  }
}

class ModalLoginDialog extends ModalDialog.ModalDialog {
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

let lastPassButton;
function enable() {
  lastPassButton = new LastPassButton();
  Main.panel.addToStatusArea('lastPassButton', lastPassButton);
}

function disable() {
  lastPassButton.destroy();
  lastPassButton = null;
}
