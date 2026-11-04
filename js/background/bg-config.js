// Per-user configuration, persisted in chrome.storage.local under DLO_USER_CONFIG.
// Functions on `dlo.*` / `dlo_cfg_*` are called through the proxy with
// `this` = {username, callback}.
var dlo_default_cfg = {
	version: '0'
	, pmInboxInitialized: false
	, replyInboxInitialized: false
	, maxInitialMessagesShown: 50
	, pageTitle: 'Dead Letter Office'
	, deleted: []
	, saved: []
	, showModmail: false
	, conversationNewToOld: false
	, compactMode: false
	, nightMode: false
	, doImport: true
	, maxAjaxRetries: 5
	, ajaxRetryDelay: 5
	, max403Retries: 15
	, inboxRefreshInterval: 900000
	, listSort: 'newest'
	// Conversation id -> newest message time when its full page was last read
	, archiveThreads: {}
	// Counts from the last indexing run, for the diagnostics download
	, indexStats: null
};

function dloAllUserCfgs() {
	var all = dloStorage.get(USER_CONFIG_KEY);
	if (!all || typeof all !== 'object') {
		all = {};
		dloStorage.set(USER_CONFIG_KEY, all);
	}
	return all;
}

// Returns the config object for a user, creating it (from a fresh copy of the
// defaults, so users never share arrays) and filling in any missing keys.
function dloUserCfg(username) {
	var all = dloAllUserCfgs();
	if (typeof all[username] !== 'object' || all[username] === null) {
		all[username] = {};
	}
	var cfg = all[username];
	for (var attr in dlo_default_cfg) {
		if (typeof cfg[attr] === 'undefined') {
			cfg[attr] = JSON.parse(JSON.stringify(dlo_default_cfg[attr]));
		}
	}
	return cfg;
}

function dloHasUserCfg(username) {
	var all = dloStorage.get(USER_CONFIG_KEY);
	return !!(all && all[username]);
}

function dlo_cfg_save() {
	return dloStorage.save(USER_CONFIG_KEY);
}

dlo.cfg_import = function (cfg) {
	if (!cfg || typeof cfg !== 'object') return;
	if (cfg.pmInboxInitialized instanceof Array) {
		cfg.pmInboxInitialized = (cfg.pmInboxInitialized.indexOf(this.username) >= 0);
	}
	if (cfg.replyInboxInitialized instanceof Array) {
		cfg.replyInboxInitialized = (cfg.replyInboxInitialized.indexOf(this.username) >= 0);
	}
	dloAllUserCfgs()[this.username] = cfg;
	dloUserCfg(this.username);
	dlo_cfg_save();
};
dlo.cfg_set = function (prop, val) {
	if (!Object.prototype.hasOwnProperty.call(dlo_default_cfg, prop)) {
		throw new Error('Unknown config property: ' + prop);
	}
	dloUserCfg(this.username)[prop] = val;
	dlo_cfg_save();
	if (prop === 'inboxRefreshInterval') {
		dloNotifications.setRefreshInterval(val);
	}
	this.callback();
};
dlo.cfg_user_get = function (prop, username) {
	var cfg = dloUserCfg(username);
	if (typeof prop === 'undefined') {
		return cfg;
	}
	return cfg[prop];
};
dlo.cfg_get = function (prop) {
	return dlo.cfg_user_get(prop, this.username);
};

function dloCfgList(listName) {
	return {
		add: function (id) {
			var list = dloUserCfg(this.username)[listName];
			if (list.indexOf(id) >= 0) return;
			list.push(id);
			dlo_cfg_save();
		}
		, remove: function (id) {
			var list = dloUserCfg(this.username)[listName];
			var index;
			while ((index = list.indexOf(id)) >= 0) {
				list.splice(index, 1);
			}
			dlo_cfg_save();
		}
	};
}
var dlo_cfg_deleted = dloCfgList('deleted');
var dlo_cfg_saved = dloCfgList('saved');
