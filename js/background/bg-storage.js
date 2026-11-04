// Persistent state for the background context.
//
// Manifest V3 service workers have no localStorage, so everything that used to
// live there (config, drafts, the notification cache) is kept in
// chrome.storage.local instead. The whole store is read into memory once when
// the background context starts; `yairStorage.ready` resolves when that is done
// and every message handler waits on it before touching state.
//
// On the first run after upgrading from the Manifest V2 build, the old
// localStorage data is copied across. In Chrome that needs an offscreen
// document (service workers can't read localStorage); Firefox's background
// page can read it directly.

// Callback-style chrome.* call wrapped in a Promise. Callbacks work on both
// Chrome and Firefox, whereas promise support on the `chrome` namespace varies.
function chromeCall(fn, ctx) {
	var args = Array.prototype.slice.call(arguments, 2);
	return new Promise(function (resolve, reject) {
		args.push(function (result) {
			var err = chrome.runtime.lastError;
			if (err) reject(new Error(err.message));
			else resolve(result);
		});
		fn.apply(ctx, args);
	});
}

var yairStorage = (function () {
	var state = {};
	var OFFSCREEN_URL = 'offscreen/migrate.html';

	function save(key) {
		var obj = {};
		obj[key] = state[key];
		return chromeCall(chrome.storage.local.set, chrome.storage.local, obj).catch(function (e) {
			console.error('YAIR: failed to persist', key, e);
		});
	}

	function readLegacyLocalStorage() {
		// Firefox event page (or any background context with a DOM)
		if (typeof localStorage !== 'undefined') {
			var copy = {};
			for (var i = 0; i < localStorage.length; i++) {
				var k = localStorage.key(i);
				copy[k] = localStorage.getItem(k);
			}
			return Promise.resolve(copy);
		}
		// Chrome service worker: read it through an offscreen document
		if (!chrome.offscreen || !chrome.offscreen.createDocument) {
			return Promise.resolve(null);
		}
		return chromeCall(chrome.offscreen.createDocument, chrome.offscreen, {
			url: OFFSCREEN_URL
			, reasons: ['LOCAL_STORAGE']
			, justification: 'Copy YAIR settings and drafts from the old Manifest V2 storage'
		}).catch(function (e) {
			// A document left over from an interrupted run is fine to reuse
			if (!/single offscreen/i.test(e.message)) throw e;
		}).then(function () {
			return chromeCall(chrome.runtime.sendMessage, chrome.runtime, {
				target: 'offscreen'
				, action: 'readLegacyLocalStorage'
			});
		}).then(function (data) {
			return chromeCall(chrome.offscreen.closeDocument, chrome.offscreen).catch(function () {}).then(function () {
				return data || null;
			});
		});
	}

	function parseJSON(str, fallback) {
		if (typeof str !== 'string') return fallback;
		try {
			return JSON.parse(str);
		}
		catch (e) {
			return fallback;
		}
	}

	function migrateLegacy(legacy) {
		if (!legacy) return;
		var migrated = [];
		if (!state.YAIR_USER_CONFIG && legacy.YAIR_USER_CONFIG) {
			state.YAIR_USER_CONFIG = parseJSON(legacy.YAIR_USER_CONFIG, {});
			migrated.push('config');
		}
		if (!state.YAIR_DRAFTS && legacy.YAIR_DRAFTS) {
			// Old layout: YAIR_DRAFTS = {user: [key, ...]}
			//             YAIR_DRAFT_<user>_<key> = {key, timestamp, value}
			var index = parseJSON(legacy.YAIR_DRAFTS, {});
			var drafts = {};
			Object.keys(index).forEach(function (user) {
				drafts[user] = {};
				(index[user] || []).forEach(function (key) {
					var draft = parseJSON(legacy['YAIR_DRAFT_' + user + '_' + key], null);
					if (draft && draft.value) {
						drafts[user][key] = {
							timestamp: draft.timestamp || Date.now()
							, value: draft.value
						};
					}
				});
			});
			state.YAIR_DRAFTS = drafts;
			migrated.push('drafts');
		}
		if (state.inboxRefreshInterval === undefined && legacy.inboxRefreshInterval) {
			state.inboxRefreshInterval = +legacy.inboxRefreshInterval || 60000;
			migrated.push('refresh interval');
		}
		if (migrated.length) {
			console.log('YAIR: migrated ' + migrated.join(', ') + ' from Manifest V2 storage');
			return chromeCall(chrome.storage.local.set, chrome.storage.local, {
				YAIR_USER_CONFIG: state.YAIR_USER_CONFIG || {}
				, YAIR_DRAFTS: state.YAIR_DRAFTS || {}
				, inboxRefreshInterval: state.inboxRefreshInterval || 60000
			});
		}
	}

	var ready = chromeCall(chrome.storage.local.get, chrome.storage.local, null).then(function (items) {
		state = items || {};
		if (state.migratedFromMV2) return;
		return readLegacyLocalStorage().then(migrateLegacy).then(function () {
			state.migratedFromMV2 = true;
			return save('migratedFromMV2');
		}).catch(function (e) {
			// Leave the flag unset so the migration is retried on the next start
			console.warn('YAIR: could not migrate Manifest V2 storage', e);
		});
	}).catch(function (e) {
		console.error('YAIR: failed to load storage', e);
	});

	return {
		ready: ready
		, get: function (key) {
			return state[key];
		}
		, set: function (key, value) {
			state[key] = value;
			return save(key);
		}
		// Persist a key whose (object) value was mutated in place
		, save: save
	};
})();
