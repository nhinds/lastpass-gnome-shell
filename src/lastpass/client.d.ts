declare const { GObject, St, Clutter, GLib, Gio, Meta, Pango, Shell } = imports.gi;


export class LastPassClient {
  constructor();

  getVault(username: string, password: string): Promise<Vault>;
  readVaultFromFile(file: Gio.File): Promise<any>;
}

interface Vault {
  write(file: Gio.File): Promise<void>;
}