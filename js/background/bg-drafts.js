// Reply drafts, persisted in chrome.storage.local under YAIR_DRAFTS as
// {username: {conversationId: {timestamp, value}}}.
// Called through the proxy with `this` = {username, callback}.
var drafts = (function () {
	function all() {
		var d = yairStorage.get('YAIR_DRAFTS');
		if (!d || typeof d !== 'object') {
			d = {};
			yairStorage.set('YAIR_DRAFTS', d);
		}
		return d;
	}

	function forUser(user) {
		var d = all();
		if (!d[user] || typeof d[user] !== 'object' || d[user] instanceof Array) {
			d[user] = {};
		}
		return d[user];
	}

	function persist() {
		return yairStorage.save('YAIR_DRAFTS');
	}
	return {
		getAllKeys: function () {
			return Object.keys(forUser(this.username));
		}
		, get: function (key) {
			var draft = forUser(this.username)[key];
			if (!draft) return false;
			// Reading a draft keeps it from expiring
			draft.timestamp = Date.now();
			persist();
			return draft.value;
		}
		, set: function (key, value) {
			if (!value) {
				return drafts.delete.call(this, key);
			}
			forUser(this.username)[key] = {
				timestamp: Date.now()
				, value: value
			};
			persist();
			return true;
		}
		, delete: function (key) {
			var userDrafts = forUser(this.username);
			if (!userDrafts[key]) return false;
			delete userDrafts[key];
			persist();
			return true;
		}
		, deleteOld: function () {
			var d = all();
			var changed = false;
			Object.keys(d).forEach(function (user) {
				var days = yair.cfg_user_get('deleteDraftAfterDays', user);
				var cutOffTime = Date.now() - days * 24 * 60 * 60 * 1000;
				var userDrafts = forUser(user);
				Object.keys(userDrafts).forEach(function (key) {
					var draft = userDrafts[key];
					if (!draft || !draft.value || draft.timestamp < cutOffTime) {
						delete userDrafts[key];
						changed = true;
					}
				});
			});
			if (changed) persist();
		}
	};
})();
yairStorage.ready.then(function () {
	drafts.deleteOld();
});
