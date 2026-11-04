// Local message store: one IndexedDB database per Reddit user.
//
// Connections are opened lazily, so every call works even if the service
// worker was stopped and restarted since the inbox page called `init`.
(function () {
	var DB_VERSION = 4;
	var DB_NAME = "YAIR_Messages";

	function openDatabase(username) {
		return new Promise(function (resolve, reject) {
			var req = self.indexedDB.open(DB_NAME + username, DB_VERSION);
			req.onerror = function () {
				reject(req.error);
			};
			req.onblocked = function () {
				console.warn("DLO: database upgrade blocked by another open connection", username);
			};
			req.onsuccess = function () {
				var db = req.result;
				// Let a future version upgrade proceed instead of blocking on us
				db.onversionchange = function () {
					db.close();
					delete dbInstances[username];
				};
				resolve(new DBInstance(username, db));
			};
			req.onupgradeneeded = function () {
				var db = req.result;
				Object.keys(db_tables).forEach(function (tableName) {
					var table = db_tables[tableName];
					if (db.objectStoreNames.contains(tableName)) {
						db.deleteObjectStore(tableName);
					}
					var store = db.createObjectStore(tableName, {
						keyPath: table.key
					});
					table.indexes.forEach(function (index) {
						store.createIndex(index, index, {
							unique: false
						});
					});
				});
				// The store was (re)created empty, so a full index is needed
				var cfg = yairUserCfg(username);
				cfg.pmInboxInitialized = false;
				cfg.replyInboxInitialized = false;
				yair_cfg_save();
			};
		});
	}

	function DBInstance(username, db) {
		this.username = username;
		this.db = db;
	}

	function requestToPromise(req, label) {
		return new Promise(function (resolve, reject) {
			req.onsuccess = function () {
				resolve(req.result);
			};
			req.onerror = function () {
				console.error("DLO: " + label + " failed", req.error);
				reject(req.error);
			};
		});
	}
	DBInstance.prototype.getObjectStore = function (store_name, mode) {
		return this.db.transaction(store_name, mode).objectStore(store_name);
	};
	DBInstance.prototype.clearObjectStore = function (store_name) {
		return requestToPromise(this.getObjectStore(store_name, db_mode.readwrite).clear(), "clear store");
	};
	DBInstance.prototype.countObjectsInStore = function (store_name) {
		return requestToPromise(this.getObjectStore(store_name, db_mode.readonly).count(), "count store");
	};
	DBInstance.prototype.get = function (store_name, index, reverse, from, limit) {
		if (typeof limit !== "number") limit = -1;
		if (typeof from !== "number") from = 0;
		if (typeof reverse !== "boolean") reverse = true;
		var store = this.getObjectStore(store_name, db_mode.readonly);
		var keyRange = null;
		if (index && typeof index === "object") {
			keyRange = IDBKeyRange.only(index.value);
			index = index.key;
		}
		var results = [];
		return new Promise(function (resolve) {
			var req = store.index(index).openCursor(keyRange, reverse ? 'prev' : 'next');
			req.onerror = function () {
				console.error("DLO: cursor failed", req.error);
				// Return whatever was collected before the failure
				resolve(results);
			};
			req.onsuccess = function () {
				var cursor = req.result;
				if (!cursor) return resolve(results);
				if (from > 0) {
					cursor.advance(from);
					from = 0;
					return;
				}
				results.push(cursor.value);
				if (--limit === 0) return resolve(results);
				cursor.continue();
			};
		});
	};
	// Writes many objects in a single transaction. With `overwrite` false,
	// objects whose key already exists are left untouched. Resolves with the
	// number of objects written.
	DBInstance.prototype.writeAll = function (store_name, arr, overwrite) {
		var db = this.db;
		return new Promise(function (resolve, reject) {
			if (!arr || !arr.length) return resolve(0);
			var tx = db.transaction(store_name, db_mode.readwrite);
			var store = tx.objectStore(store_name);
			var written = 0;
			arr.forEach(function (obj) {
				if (!obj) return;
				var req = overwrite ? store.put(obj) : store.add(obj);
				req.onsuccess = function () {
					written++;
				};
				req.onerror = function (e) {
					// Duplicate keys are expected when re-indexing; don't abort the transaction
					if (req.error && req.error.name === 'ConstraintError') {
						e.preventDefault();
						e.stopPropagation();
					}
					else {
						console.error("DLO: failed to write to DB", req.error, obj);
						e.preventDefault();
					}
				};
			});
			tx.oncomplete = function () {
				resolve(written);
			};
			tx.onerror = function () {
				// Individual request errors are handled above; this is for anything else
				if (tx.error) console.error("DLO: transaction error", tx.error);
			};
			tx.onabort = function () {
				reject(tx.error || new Error('Transaction aborted'));
			};
		});
	};
	var dbInstances = {};

	function instance(username) {
		if (!dbInstances[username]) {
			dbInstances[username] = openDatabase(username).catch(function (e) {
				delete dbInstances[username];
				throw e;
			});
		}
		return dbInstances[username];
	}
	yair.db = {
		instance: instance
		, init: function () {
			return instance(this.username).then(function () {
				return true;
			});
		}
		, clearObjectStore: function (store_name) {
			return instance(this.username).then(function (db) {
				return db.clearObjectStore(store_name);
			});
		}
		, countObjectsInStore: function (store_name) {
			return instance(this.username).then(function (db) {
				return db.countObjectsInStore(store_name);
			});
		}
		, 'get': function (store_name, index, reverse, from, limit) {
			return instance(this.username).then(function (db) {
				return db.get(store_name, index, reverse, from, limit);
			});
		}
		, add: function (store_name, obj) {
			return yair.db.addAll.call(this, store_name, [obj]).then(function (n) {
				return n > 0;
			});
		}
		, addAll: function (store_name, arr) {
			return instance(this.username).then(function (db) {
				return db.writeAll(store_name, arr, false);
			});
		}
		, update: function (store_name, obj) {
			return yair.db.updateAll.call(this, store_name, [obj]);
		}
		, updateAll: function (store_name, arr) {
			return instance(this.username).then(function (db) {
				return db.writeAll(store_name, arr, true);
			});
		}
	};
})();
