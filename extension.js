// vim: ts=2:sw=2:et
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

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
const Convenience = Me.imports.convenience;
const Typer = Me.imports.typer.Typer;
const HistoryTracker = Me.imports.history_tracker.HistoryTracker;
const LastPassClient = Me.imports.lastpass.client.LastPassClient;

const ICON_NAME = 'channel-secure-symbolic';

// TODO make this configurable
const enableHistory = true;

var LastPassButton = GObject.registerClass(
class LastPassButton extends PanelMenu.Button {
  _init() {
    super._init(St.Align.START, 'LastPass');

    let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
    this.icon = new St.Icon({ icon_name: ICON_NAME, style_class: 'system-status-icon lastpass-icon' });
    hbox.add_child(this.icon);
    actorFor(this).add_actor(hbox);

    this._typer = new Typer();
    this._typer.connect('finished', () => this.icon.remove_style_class_name('lastpass-typing'));
    this._client = new LastPassClient();

    this._settings = Convenience.getSettings();
    this._historyTracker = new HistoryTracker();

    this._favouriteAccounts = new Set(this._settings.get_strv('favourite-accounts'));
    this._vault = null;
    this._accounts = null;

    this._createMenu();
    this._bindShortcuts();
    this.connect('destroy', this._unBindShortcuts.bind(this));

    this._readVault().catch(error => {
      print(`Error loading vault from disk: ${error.message}`);
    });
  }

  _createMenu() {
    actorFor(this.menu).add_style_class_name('lastpass-menu');

    this.favouriteSection = new PopupMenu.PopupMenuSection();
    this.menu.addMenuItem(this.favouriteSection);
    this._createFavouriteMenuItems();

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    if (enableHistory) {
      this._historySection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._historySection);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
    }

    this.otherSection = new PopupMenu.PopupMenuSection();
    this.menu.addMenuItem(this.otherSection);
    this._createOtherMenuItems();

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this.menu.addAction('Refresh Vault', () => {
      this._clearVault();
      this._openVault(false).catch(error => {
        print(`Could not open LastPass vault: ${error.message}`);
      });
    });
  }

  _createFavouriteMenuItems() {
    let accounts = this._accounts;
    this.favouriteSection.removeAll();
    for (let accountName of this._favouriteAccounts) {
      let username = '';
      if (accounts != null && accounts.hasOwnProperty(accountName)) {
        username = accounts[accountName].username;
      }
      this._addAccountItem(this.favouriteSection, accountName, username, this._favouriteButton);
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
          this._addAccountItem(otherMenu, accountName, account.username, this._favouriteButton);
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

  _addAccountItem(menu, accountName, username, buttonGenerator) {
    let accountItem = menu.addAction(this._getAccountDisplayName(accountName, username), () => {
      this._recordUsageOfItem(accountName, username);
      this._openVault(false).then(accounts => this._type(accounts[accountName].password)).catch(e => {
        print(`Error typing password: ${e.message}`);
      });
    });

    actorFor(accountItem).add_child(buttonGenerator.call(this, accountName, username));
    return accountItem;
  }

  _recordUsageOfItem(accountName, username) {
    // Short circut if history is not
    if (!enableHistory)
      return;

    // If the thing that was clicked on is a favourite item then don't add it to the history since then it would appear in the menu
    // twice and look weird.
    if (this._favouriteAccounts.has(accountName))
      return;

    this._historyTracker.trackAccess(accountName, username);

    this._recreateHistoryMenu();
  }

  _recreateHistoryMenu() {
    // Rebuild the history menu since it's hard to reliably remove elements from the menu without calling internal functions.
    this._historySection.removeAll();
    this._historyTracker.forEach((accountName, username) => this._addAccountItem(this._historySection, accountName, username, this._deleteButton));
  }

  _deleteButton(accountName, username) {
    const deleteIcon = new St.Icon({icon_name: 'edit-delete-symbolic', style_class: 'system-status-icon' });
    const deleteButton = new St.Button({
      style_class: 'lastpass-delete-button',
      x_fill: true,
      x_expand: true,
      y_expand: true,
      can_focus: true,
      child: deleteIcon
    });

    // There are two x-align properties in the hierarchy of St.Button, and trying to set this in the constructor has tries to set the wrong one
    deleteButton.set_x_align(Clutter.ActorAlign.END);
    deleteButton.connect('clicked', () => {
      if (!this._historyTracker.removeEntry(accountName, username)) {
        throw "item not found in tracker";
      };
      this._recreateHistoryMenu();
    });
    return deleteButton;
  }

  /**
   * Create a favourite button which adds, or removes, items from the star-list
   *
   * @param {string} accountName
   * @param {string} _
   * @returns {St.Button} the button to added to the menu item.
   */
  _favouriteButton(accountName, _) {
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
    return favouriteButton;
  }

  _isFavourited(accountName) {
    return this._favouriteAccounts.has(accountName);
  }

  _setFavourited(accountName, favourited) {
    if (favourited) {
      this._favouriteAccounts.add(accountName);
    } else {
      this._favouriteAccounts.delete(accountName);
    }
    if (!this._settings.set_strv('favourite-accounts', Array.from(this._favouriteAccounts))) {
      print('Warning: unable to save favourite accounts');
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
    if (!username) {
      username = this._settings.get_string('last-username');
    }
    let vault = this._vault;
    let credentials;
    if (vault == null) {
      credentials = await ModalLoginDialog.prompt({ initialUsername: username, errorMessage: errorMessage });
      if (username != credentials.username) {
        this._settings.set_string('last-username', credentials.username);
      }
      try {
        // TODO better feedback while logging in - keep the modal dialog open?
        vault = await this._client.getVault(credentials.username, credentials.password);
        this._vault = vault;
        // TODO preference to skip saving the vault?
        await this._saveVault();
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

  async _saveVault() {
    try {
      let cacheDirectory = Gio.file_new_for_path(GLib.get_user_cache_dir()).get_child(Me.uuid);
      if (GLib.mkdir_with_parents(cacheDirectory.get_path(), parseInt('0755', 8)) != 0) {
        throw new Error(`Could not create cache directory ${cacheDirectory.get_path()}`);
      }
      let vaultFile = cacheDirectory.get_child('vault');
      await this._vault.write(vaultFile);
    } catch (e) {
      print(`Error saving vault: ${e.message}`);
    }
  }

  async _readVault() {
    // TODO commonize
    let cacheDirectory = Gio.file_new_for_path(GLib.get_user_cache_dir()).get_child(Me.uuid);
    let vaultFile = cacheDirectory.get_child('vault');
    if (vaultFile.query_exists(null)) {
      // TODO check last write timestamp?
      this._vault = await this._client.readVaultFromFile(vaultFile);
    }
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

    this._oneOffTimer(this._settings.get_int('typing-initial-pause'), () => this._typer.type(text, this._settings.get_int('typing-half-delay')));
  }

  _oneOffTimer(pause, callback) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, pause, () => {
      callback();
      return GLib.SOURCE_REMOVE;
    });
  }

  _bindShortcuts() {
    Main.wm.addKeybinding(
      'toggle-lastpass-menu',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => {
        this.menu.toggle();
        actorFor(this.menu).get_stage().set_key_focus(actorFor(this._itemToFocus()))
      }
    );
  }

  _itemToFocus() {
    if (this.favouriteSection.firstMenuItem) {
      return this.favouriteSection.firstMenuItem;
    }
    if (enableHistory && this._historySection.firstMenuItem) {
      return this._historySection.firstMenuItem;
    }
    return this.otherSection.firstMenuItem;
  }

  _unBindShortcuts() {
    Main.wm.removeKeybinding('toggle-lastpass-menu');
  }
});

class ModalLoginDialog {
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
    this.dialog = new ModalDialog.ModalDialog({ styleClass: 'prompt-dialog' });
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
    this.dialog.contentLayout.add(this._content);

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

    this.dialog.addButton({
      label: 'Cancel',
      key: Clutter.Escape,
      action: () => this._cancelLogin()
    });
    this._loginButton = this.dialog.addButton({
      label: 'Login',
      default: true,
      action: () => this._doneLogin()
    });

    this._updateLoginButton();
    this.dialog.setInitialKeyFocus(this._reprompt || params.initialUsername.length > 0 ? this._passwordEntry : this._usernameEntry);

    let sessionModeSignalId = Main.sessionMode.connect('updated', () => {
      if (!Main.sessionMode.isLocked)
        return;

      this._cancelLogin();
    });
    this.dialog.connect('closed', () => Main.sessionMode.disconnect(sessionModeSignalId));

    this.dialog.open();
  }

  _isLoginValid() {
    return (this._reprompt || this._usernameEntry.get_text().length > 0) && this._passwordEntry.get_text().length > 0;
  }

  _updateLoginButton() {
    this._loginButton.reactive = this._loginButton.can_focus = this._isLoginValid();
  }

  _cancelLogin() {
    this.dialog.close();
    this.emit('cancelled');
  }

  _doneLogin() {
    if (!this._isLoginValid()) {
      return;
    }

    this.dialog.close();
    this.emit('login', this._reprompt ? '' : this._usernameEntry.get_text(), this._passwordEntry.get_text(), false); // TODO "remember" functionality
  }
}
Signals.addSignalMethods(ModalLoginDialog.prototype);

function actorFor(obj) {
  // For version 3.34 and above, many objects have been migrated to Clutter.Actor subclasses.
  // CallingClutter.Actor.actor **works**, but logs a deprecation warning.
  if (obj instanceof Clutter.Actor) {
    return obj;
  } else {
    return obj.actor;
  }
}

let lastPassButton;
function enable() {
  lastPassButton = new LastPassButton();
  Main.panel.addToStatusArea('lastPassButton', lastPassButton);
}

function disable() {
  if (lastPassButton) {
    lastPassButton.destroy();
    lastPassButton = null;
  }
}
