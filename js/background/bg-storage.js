// Persistent state for the background context.
//
// Manifest V3 service workers have no localStorage, so config, drafts, and
// the notification cache live in chrome.storage.local. The whole store is
// read into memory once when the background context starts; `dloStorage.ready`
// resolves when that is done and every message handler waits on it.

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

// Where per-user config lives. Versions before 2.0 used YAIR_USER_CONFIG.
var USER_CONFIG_KEY = 'DLO_USER_CONFIG';
var LEGACY_USER_CONFIG_KEY = 'YAIR_USER_CONFIG';

var dloStorage = (function () {
	var state = {};

	function save(key) {
		var obj = {};
		obj[key] = state[key];
		return chromeCall(chrome.storage.local.set, chrome.storage.local, obj).catch(function (e) {
			console.error('DLO: failed to persist', key, e);
		});
	}

	// One-time move from the YAIR-era key. The old copy is removed only after
	// the new one has been written.
	function migrateLegacyConfig() {
		if (!state[LEGACY_USER_CONFIG_KEY] || state[USER_CONFIG_KEY]) return Promise.resolve(false);
		state[USER_CONFIG_KEY] = state[LEGACY_USER_CONFIG_KEY];
		return save(USER_CONFIG_KEY).then(function () {
			delete state[LEGACY_USER_CONFIG_KEY];
			return chromeCall(chrome.storage.local.remove, chrome.storage.local, LEGACY_USER_CONFIG_KEY);
		}).then(function () {
			return true;
		});
	}

	var ready = chromeCall(chrome.storage.local.get, chrome.storage.local, null).then(function (items) {
		state = items || {};
		return migrateLegacyConfig();
	}).catch(function (e) {
		console.error('DLO: failed to load storage', e);
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
		, migrateLegacyConfig: migrateLegacyConfig
	};
})();
