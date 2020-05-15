const historyLength = 5;
export var HistoryTracker = class HistoryTracker {
    constructor() {
        this._historyList = [];
    }
    trackAccess(accountName, username) {
        const newHistoryItem = { accountName, username };
        this.removeEntry(accountName, username);
        if (this._historyList.length >= historyLength) {
            this._historyList.pop();
        }
        this._historyList.unshift(newHistoryItem);
    }
    removeEntry(accountName, username) {
        const existingIndex = this._historyList.findIndex(item => item.accountName == accountName && item.username == username);
        if (existingIndex >= 0) {
            this._historyList.splice(existingIndex, 1);
            return true;
        }
        else {
            return false;
        }
    }
    forEach(callback) {
        this._historyList.forEach(item => callback(item.accountName, item.username));
    }
};
//# sourceMappingURL=history_tracker.js.map