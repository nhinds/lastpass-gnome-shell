// vim: ts=2:sw=2:et
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

// Load libraries relative to the current directory. Because require('./libs/sha256') is too simple...
// Apparently the only way to find the current directory is to inspect a stack frame. Stack frame looks like:
// @/path/to/this/file.js:123:456
const CURRENT_DIRECTORY = new Error().stack.split("\n")[0].replace(/^@/,'').replace(/client\.js:\d+:\d+$/, '');
imports.searchPath.unshift(CURRENT_DIRECTORY);
const Sha256 = imports.libs.sha256.sha256;
const FromXML = imports.libs['from-xml'];
const Aes = imports.libs.aes.aesjs;
imports.searchPath.shift();

var LastPassClient = class LastPassClient {
  constructor() {
    this._protocol = new Protocol();
    this._crypto = new Crypto();
  }

  async getVault(username, password) {
    let iterations = await this._protocol.iterations(username);
    let sessionId = await this._protocol.login(username, this._crypto.hash(username, password, iterations), iterations);
    let rawAccounts = await this._protocol.accounts(sessionId);
    await this._protocol.logout(sessionId);

    return this._parseAccounts(rawAccounts, username, iterations);
  }


  // In: file:Gio.File. Out: Vault
  async readVaultFromFile(file) {
    let contents = await new Promise((resolve, reject) => {
      file.load_contents_async(null, (file, result) => {
        let [ok, contents] = file.load_contents_finish(result);
        if (ok) {
          resolve(contents);
        } else {
          reject();
        }
      });
    });

    // TODO place the de/serialization somewhere more sensible
    let variant = GLib.Variant.new_from_bytes(new GLib.VariantType('(siay)'), contents, false);
    let [username, iterations, rawAccounts] = variant.deep_unpack();
    return this._parseAccounts(rawAccounts, username, iterations);
  }

  _parseAccounts(rawAccounts, username, iterations) {
    let accounts = new Parser(rawAccounts).parse();
    return new Vault(rawAccounts, accounts, username, iterations, this._crypto);
  }

  toString() {
    return 'LastPassClient';
  }
}

class Vault {
  constructor(rawAccounts, accounts, username, iterations, crypto) {
    this._rawAccounts = rawAccounts;
    this._accounts = accounts;
    this._username = username;
    this._iterations = iterations;
    this._crypto = crypto;
  }

  open(password) {
    let key = this._crypto.key(this._username, password, this._iterations);
    let accountsHash = {};

    this._accounts.forEach(account => {
      let name = this._crypto.decrypt(account.encryptedName, key);
      let username = this._crypto.decrypt(account.encryptedUsername, key);
      let password = this._crypto.decrypt(account.encryptedPassword, key);
      accountsHash[name] = new Account(name, username, password);
    });

    return accountsHash;
  }

  // In: file:Gio.File
  async write(file) {
    return new Promise((resolve, reject) => {
      // TODO include login time
      // TODO place the de/serialization somewhere more sensible
      let variant = new GLib.Variant('(siay)', [this._username, this._iterations, this._rawAccounts]);
      let serialized = variant.get_data_as_bytes();
      file.replace_contents_bytes_async(serialized, null, false, Gio.FileCreateFlags.PRIVATE, null, (file, result) => {
        let ok = file.replace_contents_finish(result);
        if (ok) {
          resolve();
        } else {
          reject(new Error(`Could not write vault to ${filename}`));
        }
      });
    });
  }

  toString() {
    return `Vault (${this._accounts.length} accounts)`;
  }
}

class Account {
  constructor(name, username, password) {
    this.name = name;
    this.username = username;
    this.password = password;
  }

  toString() {
    return `Account[${this.name}]`;
  }
}

class Protocol {
  constructor() {
    this._soup = new Soup.Session();
  }

  async login(username, hash, iterations) {
    let msg = Soup.form_request_new_from_hash('POST', 'https://lastpass.com/login.php', {
      'method': 'cr',
      'web': '1',
      'xml': '2',
      'username': username,
      'hash': hash,
      'iterations': iterations.toString()
    });
    let responseData = await this._request(msg);
    let response = FromXML.fromXML(responseData).response;
    if (response.hasOwnProperty('ok') && response.ok.hasOwnProperty('@sessionid')) {
      return response.ok['@sessionid'];
    } else if (response.hasOwnProperty('error')) {
      throw new Error(response.error.hasOwnProperty('@message') && response.error['@message'] || 'Unknown error from LastPass');
    } else {
      throw new Error('Unknown response from LastPass, not OK but no error');
    }
  }

  async logout(sessionId) {
    let msg = Soup.form_request_new_from_hash('GET', 'https://lastpass.com/logout.php', { 'mobile': '1' });
    this._addSessionCookie(msg, sessionId);
    await this._request(msg);
  }

  async iterations(username) {
    let msg = Soup.form_request_new_from_hash('POST', 'https://lastpass.com/iterations.php', { 'email': username });
    let iterationsString = await this._request(msg);
    return parseInt(iterationsString);
  }

  async accounts(sessionId) {
    let msg = Soup.form_request_new_from_hash('GET', 'https://lastpass.com/getaccts.php', { 'mobile': '1', 'hash': '0.0' });
    this._addSessionCookie(msg, sessionId);
    await this._request(msg);
    let accountData = msg.response_body_data.toArray();
    return accountData;
  }

  _addSessionCookie(msg, sessionId) {
    msg.request_headers.append('Cookie', `PHPSESSID=${Soup.URI.encode(sessionId, null)}`);
  }

  async _request(message) {
    return new Promise((resolve, reject) => {
      this._soup.queue_message(message, () => {
        if (message.status_code != 200) {
          reject(new Error(`${message.status_code} ${message.reason_phrase}`));
        } else {
          resolve(message.response_body.data);
        }
      });
    });
  }
}

class Crypto {
  // In: username:String, password: String, iterations: Integer. Out: hex string
  hash(username, password, iterations) {
    return Aes.utils.hex.fromBytes(Sha256.pbkdf2(this.key(username, password, iterations), ByteArray.fromString(password), 1, 32));
  }

  // In: username:String, password:String, iterations: Integer. Out: Uint8Array
  key(username, password, iterations) {
    if (iterations < 2) throw new Error('Iterations < 2 not implemented, and probably not secure anyway');
    return Sha256.pbkdf2(ByteArray.fromString(password), ByteArray.fromString(username), iterations, 32);
  }

  // In: data:Uint8Array, key:Uint8Array. Out: String
  decrypt(data, key) {
    if (data.length == 0) {
      return '';
    }
    let aesMode, dataToDecrypt;
    if (data.length % 16 == 0) {
      // ECB
      aesMode = new Aes.ModeOfOperation.ecb(key);
      dataToDecrypt = data;
    } else if (data.length % 16 == 1 && data[0] == '!'.charCodeAt(0)) {
      // CBC
      let iv = data.subarray(1,17);
      aesMode = new Aes.ModeOfOperation.cbc(key, iv);
      dataToDecrypt = data.subarray(17, data.length);
    } else {
      throw new Error(`Unable to decrypt data of length ${data.length}`);
    }
    let decryptedBytes = Aes.padding.pkcs7.strip(aesMode.decrypt(dataToDecrypt));
    return Aes.utils.utf8.fromBytes(decryptedBytes);
  }
}

class Parser {
  constructor(rawAccounts) {
    this._bytes = new Uint8Array(rawAccounts);
    this._data = new DataView(this._bytes.buffer);
  }

  parse() {
    this._pos = 0;
    let accounts = [];
    while (this._pos < this._bytes.length) {
      let id = this._readString(4);
      if (id == 'ENDM') {
        return accounts;
      }

      let size = this._readInt();
      let afterChunk = this._pos + size;
      if (id == 'ACCT') {
        accounts.push(this._parseACCT());
      }
      // TODO care about PRIK/SHAR?
      this._pos = afterChunk;
    }
    throw new Error('Error parsing vault, ran out of data before end marker');
  }

  _parseACCT() {
    let account = {};
    account.id = this._readString();
    account.encryptedName = this._readBytes();
    this._readBytes(); // Encrypted group
    this._readBytes(); // Hex encoded URL
    this._readBytes(); // Encrypted notes
    this._readBytes(); // Favourite
    this._readBytes(); // Shared from ID
    account.encryptedUsername = this._readBytes();
    account.encryptedPassword = this._readBytes();
    // Ignoring many fields we don't care about
    return account;
  }

  _readInt() {
    let val = this._data.getUint32(this._pos);
    this._pos += 4;
    return val;
  }

  _readBytes(length = null) {
    if (length == null) {
      length = this._readInt();
    }
    let val = this._bytes.subarray(this._pos, this._pos + length);
    this._pos += length;
    return val;
  }

  _readString(length = null) {
    return Aes.utils.utf8.fromBytes(this._readBytes(length));
  }
}
