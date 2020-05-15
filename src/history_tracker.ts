// TODO make this configurable
const historyLength = 5;

export interface HistoryItem {
  accountName: string
  username: string
}

export class HistoryTracker implements Iterable<HistoryItem> {
  /**
   * A List (array) of stuff stored in the history section. The elements are of the form { accountName: , username: } (HistoryItem)
    This format is used so the menu can be reconstructed at any point. The list is stored as most recently used at the
    'head' (lowest index) and oldest at the 'tail' (higest index).
   */
  private _historyList: HistoryItem[] = [];

  [Symbol.iterator](): Iterator<HistoryItem, any, undefined> {
    return this._historyList[Symbol.iterator]()
  }

  /**
   * Track a usage of a menu item. 
   * 
   * @param {string} accountName 
   * @param {string} username 
   */
  public trackAccess(accountName:string, username:string): void {
    const newHistoryItem = { accountName, username };

    // If this entry is _already_ in the history list, for example it was clicked from the history list, 
    // then remove it so it gets added to the top again
    this.removeEntry(accountName, username);

    // if the history area is full remove the oldest entry
    if (this._historyList.length >= historyLength) {
      // Remove the oldest entry from the tracking list
      this._historyList.pop();
    }

    // Track the new item that just got clicked.
    this._historyList.unshift(newHistoryItem);
  }

  /**
   * Remove an item from the tracked list, if it exists. Silently ignores entries that are not found.
   * 
   * @param {string} accountName 
   * @param {string} username 
   * @returns {boolean} true if the item was removed, false otherwise
   */
  removeEntry(accountName: string, username: string): boolean {
    const existingIndex = this._historyList.findIndex(item => item.accountName == accountName && item.username == username);

    if (existingIndex >= 0) {
      this._historyList.splice(existingIndex, 1);
      return true;
    } else {
      return false;
    }
  }

  /**
   * Call the `callback` for each tracked `HistoryItem` struct, in the order they need to be displayed (newest to oldest)
   * 
   * @param {function} callback The action to be performed on each item. Has two parameters: `accountName` and `username`
   * @deprecated
   */
  forEach(callback: (accountName: string, username: string)=> void): void {
    this._historyList.forEach(item => callback(item.accountName, item.username));
  }
}