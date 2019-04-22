// TODO make this configurable
const historyLength = 5;

function HistoryItem(accountName, username) {
  return {
    accountName: accountName,
    username: username,
  };
};

var HistoryTracker = class HistoryTracker {
  constructor() {
    // A List (array) of stuff stored in the history section. The elements are of the form { accountName: , username: } (HistoryItem)
    // This format is used so the menu can be reconstructed at any point. The list is stored as most recently used at the
    // 'head' (lowest index) and oldest at the 'tail' (higest index).
    this._historyList = [];  
  }

  /**
   * Track a usage of a menu item. 
   * 
   * @param {string} accountName 
   * @param {string} username 
   */
  trackAccess(accountName, username) {
    const newHistoryItem = HistoryItem(accountName, username);

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
  removeEntry(accountName, username) {
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
   */
  forEach(callback) {
    this._historyList.forEach(item => callback(item.accountName, item.username));
  }
}