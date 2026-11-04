// Per-user configuration, persisted in chrome.storage.local under YAIR_USER_CONFIG.
// Functions on `yair.*` / `yair_cfg_*` are called through the proxy with
// `this` = {username, callback}.
var yair_default_cfg = {
	version: '0'
	, pmInboxInitialized: false
	, replyInboxInitialized: false
	, maxInitialMessagesShown: 50
	, pageTitle: 'Reddit - YAIR'
	, deleted: []
	, saved: []
	, showModmail: false
	, conversationNewToOld: false
	, compactMode: false
	, nightMode: false
	, deleteDraftAfterDays: 60
	, doImport: true
	, maxAjaxRetries: 5
	, ajaxRetryDelay: 5
	, max403Retries: 15
	, inboxRefreshInterval: 60000
	, listSort: 'newest'
	// Conversation id -> newest message time when its full page was last read
	, archiveThreads: {}
};

function yairAllUserCfgs() {
	var all = yairStorage.get('YAIR_USER_CONFIG');
	if (!all || typeof all !== 'object') {
		all = {};
		yairStorage.set('YAIR_USER_CONFIG', all);
	}
	return all;
}

// Returns the config object for a user, creating it (from a fresh copy of the
// defaults, so users never share arrays) and filling in any missing keys.
function yairUserCfg(username) {
	var all = yairAllUserCfgs();
	if (typeof all[username] !== 'object' || all[username] === null) {
		all[username] = {};
	}
	var cfg = all[username];
	for (var attr in yair_default_cfg) {
		if (typeof cfg[attr] === 'undefined') {
			cfg[attr] = JSON.parse(JSON.stringify(yair_default_cfg[attr]));
		}
	}
	return cfg;
}

function yairHasUserCfg(username) {
	var all = yairStorage.get('YAIR_USER_CONFIG');
	return !!(all && all[username]);
}

function yair_cfg_save() {
	return yairStorage.save('YAIR_USER_CONFIG');
}

yair.cfg_import = function (cfg) {
	if (!cfg || typeof cfg !== 'object') return;
	if (cfg.pmInboxInitialized instanceof Array) {
		cfg.pmInboxInitialized = (cfg.pmInboxInitialized.indexOf(this.username) >= 0);
	}
	if (cfg.replyInboxInitialized instanceof Array) {
		cfg.replyInboxInitialized = (cfg.replyInboxInitialized.indexOf(this.username) >= 0);
	}
	yairAllUserCfgs()[this.username] = cfg;
	yairUserCfg(this.username);
	yair_cfg_save();
};
yair.cfg_set = function (prop, val) {
	if (!Object.prototype.hasOwnProperty.call(yair_default_cfg, prop)) {
		throw new Error('Unknown config property: ' + prop);
	}
	yairUserCfg(this.username)[prop] = val;
	yair_cfg_save();
	if (prop === 'inboxRefreshInterval') {
		yairNotifications.setRefreshInterval(val);
	}
	this.callback();
};
yair.cfg_user_get = function (prop, username) {
	var cfg = yairUserCfg(username);
	if (typeof prop === 'undefined') {
		return cfg;
	}
	return cfg[prop];
};
yair.cfg_get = function (prop) {
	return yair.cfg_user_get(prop, this.username);
};

function yairCfgList(listName) {
	return {
		add: function (id) {
			var list = yairUserCfg(this.username)[listName];
			if (list.indexOf(id) >= 0) return;
			list.push(id);
			yair_cfg_save();
		}
		, remove: function (id) {
			var list = yairUserCfg(this.username)[listName];
			var index;
			while ((index = list.indexOf(id)) >= 0) {
				list.splice(index, 1);
			}
			yair_cfg_save();
		}
	};
}
var yair_cfg_deleted = yairCfgList('deleted');
var yair_cfg_saved = yairCfgList('saved');
