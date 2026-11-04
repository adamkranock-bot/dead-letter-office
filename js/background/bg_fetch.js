// Network access to Reddit plus the unread-message notifier.
//
// Polling uses chrome.alarms because Manifest V3 service workers are stopped
// when idle, which would silently kill a setInterval timer.
var REDDIT_ORIGIN = 'https://old.reddit.com';
var REDDIT_WWW = 'https://www.reddit.com';
var FULLNAME_RE = /^t\d_[a-z0-9]+$/i;

function redditRequest(url, options) {
	options = Object.assign({
		credentials: 'include'
		, cache: 'no-store'
	}, options || {});
	return fetch(url, options).then(function (response) {
		if (!response.ok) {
			var err = new Error('Reddit returned HTTP ' + response.status);
			err.status = response.status;
			throw err;
		}
		var type = response.headers.get('content-type') || '';
		return type.indexOf('json') >= 0 ? response.json() : response.text();
	});
}

function toPrivateMessageRecord(data) {
	return {
		id: data.id
		, author: data.author || (data.subreddit ? '#' + data.subreddit : '[unknown]')
		, body: data.body
		, body_html: data.body_html
		, created_utc: data.created_utc
		, dest: data.dest
		, distinguished: data.distinguished
		, first_message_name: data.first_message_name || data.name
		, name: data.name
		, 'new': data['new']
		, subject: data.subject
	};
}

var yairNotifications = (function () {
	var ALARM = 'yair-refresh-notifications';
	// Reddit moved DMs to Chat, so unread PMs are rare now: check every 15
	// minutes by default, and not at all when set to 0 ("Off").
	var DEFAULT_INTERVAL = 900000;

	function intervalMs() {
		var stored = yairStorage.get('inboxRefreshInterval');
		return (stored === undefined || stored === null || isNaN(+stored)) ? DEFAULT_INTERVAL : +stored;
	}

	function intervalMinutes() {
		// Chrome won't fire alarms more often than every 30 seconds
		return Math.max(0.5, intervalMs() / 60000);
	}

	function schedule() {
		if (intervalMs() <= 0) {
			chrome.alarms.clear(ALARM);
			setBadge(0);
			return;
		}
		var minutes = intervalMinutes();
		chrome.alarms.get(ALARM, function (alarm) {
			if (alarm && alarm.periodInMinutes === minutes) return;
			chrome.alarms.create(ALARM, {
				delayInMinutes: minutes
				, periodInMinutes: minutes
			});
		});
	}

	function setBadge(count) {
		chrome.action.setBadgeBackgroundColor({
			color: [255, 123, 85, 255]
		});
		chrome.action.setBadgeText({
			text: count > 0 ? '' + count : ''
		});
	}

	function update() {
		return redditRequest(REDDIT_WWW + '/message/unread.json?raw_json=1').then(function (data) {
			if (!data || !data.data || !data.data.children) {
				throw new Error('Unexpected response from Reddit');
			}
			var pms = data.data.children.filter(function (m) {
				return m.kind === 't4';
			});
			yairStorage.set('notifications', data);
			yairStorage.set('lastUpdate', yairTimeNow());
			yairStorage.set('notificationCount', pms.length);
			setBadge(pms.length);
			// Store new messages for users whose inbox has already been indexed
			var byUser = {};
			pms.forEach(function (m) {
				var user = m.data.dest;
				if (!yairHasUserCfg(user) || !yairUserCfg(user).pmInboxInitialized) return;
				(byUser[user] = byUser[user] || []).push(toPrivateMessageRecord(m.data));
			});
			return Promise.all(Object.keys(byUser).map(function (user) {
				return yair.db.addAll.call({
					username: user
				}, db_tables.privateMessages.name, byUser[user]).catch(function (e) {
					console.error('DLO: could not store new messages for', user, e);
				});
			})).then(function () {
				return data;
			});
		});
	}
	chrome.alarms.onAlarm.addListener(function (alarm) {
		if (alarm.name !== ALARM) return;
		yairStorage.ready.then(update).catch(function (e) {
			console.warn('DLO: notification refresh failed', e.message);
		});
	});
	return {
		update: update
		, schedule: schedule
		, intervalMs: intervalMs
		, setBadge: setBadge
		, setRefreshInterval: function (ms) {
			ms = parseInt(ms, 10);
			if (isNaN(ms) || ms < 0) return;
			yairStorage.set('inboxRefreshInterval', ms);
			schedule();
		}
	};
})();

function yairTimeNow() {
	return Math.floor(Date.now() / 1000);
}

// Actions the content scripts and popup can request with {action: name, ...}
var actions = {
	// One page (up to 100 threads) of the private message listing
	getPrivateMessages: function (request) {
		var params = new URLSearchParams({
			raw_json: '1'
			, limit: '100'
		});
		if ((request.direction === 'before' || request.direction === 'after') && FULLNAME_RE.test(request.reference || '')) {
			params.set(request.direction, request.reference);
		}
		return redditRequest(REDDIT_ORIGIN + '/message/messages.json?' + params.toString());
	}
	// One page of Reddit's private message archive (new Reddit HTML). Reddit
	// stopped serving PM history through messages.json, so this is now the
	// main source. Returns the HTML for the content script to parse.
	, getArchivePage: function (request) {
		var url;
		try {
			url = new URL(request.path || '/message/messages/', REDDIT_WWW);
		}
		catch (e) {
			return Promise.reject(new Error('Invalid archive URL'));
		}
		if (url.origin !== REDDIT_WWW || !/^\/(message\/messages|svc\/shreddit\/)/.test(url.pathname)) {
			return Promise.reject(new Error('Refusing to fetch ' + url.pathname));
		}
		function attempt(triesLeft, delayMs) {
			return fetch(url.toString(), {
				credentials: 'include'
				, cache: 'no-store'
				, headers: {
					'Accept': 'text/html'
				}
			}).then(function (response) {
				// Reddit rate limits quick successive page loads; back off and retry
				if ((response.status === 429 || response.status >= 500) && triesLeft > 0) {
					var retryAfter = parseInt(response.headers.get('retry-after'), 10);
					var wait = retryAfter > 0 ? Math.min(retryAfter * 1000, 60000) : delayMs;
					return new Promise(function (resolve) {
						setTimeout(resolve, wait);
					}).then(function () {
						return attempt(triesLeft - 1, delayMs * 2);
					});
				}
				return response;
			});
		}
		return attempt(4, 2000).then(function (response) {
			if (!response.ok) {
				var err = new Error('Reddit returned HTTP ' + response.status);
				err.status = response.status;
				throw err;
			}
			return response.text().then(function (html) {
				return {
					html: html
					, url: response.url
				};
			});
		});
	}
	, updateNotifications: function () {
		return yairNotifications.update();
	}
	// Mark messages read, on behalf of the inbox page. Done here rather than
	// from the page so it works the same in every browser (Firefox and Safari
	// restrict cross-origin requests from content scripts). Only this
	// endpoint, with validated ids, is allowed.
	, redditPost: function (request) {
		var form = request.form || {};
		var body = new URLSearchParams();
		if (request.endpoint !== 'read_message') {
			return Promise.reject(new Error('Unknown endpoint'));
		}
		var ids = String(form.id || '').split(',');
		if (!ids.length || ids.length > 100 || !ids.every(function (id) { return FULLNAME_RE.test(id); })) {
			return Promise.reject(new Error('Invalid message ids'));
		}
		body.set('id', ids.join(','));
		body.set('uh', String(form.uh || ''));
		return fetch(REDDIT_ORIGIN + '/api/' + request.endpoint, {
			method: 'POST'
			, credentials: 'include'
			, cache: 'no-store'
			, body: body
		}).then(function (response) {
			return response.text().then(function (text) {
				var json = null;
				try { json = JSON.parse(text); } catch (e) {}
				return {
					ok: response.ok
					, status: response.status
					, json: json
				};
			});
		});
	}
	, markAsRead: function (request) {
		var name = String(request.name || '');
		if (!FULLNAME_RE.test(name)) {
			return Promise.reject(new Error('Invalid message id'));
		}
		var body = new URLSearchParams({
			id: name
			, uh: request.modhash || ''
		});
		return redditRequest(REDDIT_WWW + '/api/read_message', {
			method: 'POST'
			, body: body
		}).then(function () {
			var count = Math.max(0, (+yairStorage.get('notificationCount') || 0) - 1);
			yairStorage.set('notificationCount', count);
			var notifications = yairStorage.get('notifications');
			if (notifications && notifications.data && notifications.data.children) {
				notifications.data.children = notifications.data.children.filter(function (m) {
					return m.data.name !== name;
				});
				yairStorage.save('notifications');
			}
			yairNotifications.setBadge(count);
			return true;
		});
	}
};

// YAIR checked every minute by default. That was never a choice anyone made,
// so move installs still on it to the new default once.
function yairMigratePollingDefault() {
	if (yairStorage.get('pollingDefaultV2')) return;
	if (+yairStorage.get('inboxRefreshInterval') === 60000) yairStorage.set('inboxRefreshInterval', 900000);
	var cfgs = yairStorage.get('YAIR_USER_CONFIG') || {};
	Object.keys(cfgs).forEach(function (user) {
		if (cfgs[user] && +cfgs[user].inboxRefreshInterval === 60000) cfgs[user].inboxRefreshInterval = 900000;
	});
	yairStorage.save('YAIR_USER_CONFIG');
	yairStorage.set('pollingDefaultV2', true);
}

function yairStartNotifier() {
	yairStorage.ready.then(function () {
		yairMigratePollingDefault();
		yairNotifications.schedule();
		if (yairNotifications.intervalMs() <= 0) return;
		return yairNotifications.update();
	}).catch(function (e) {
		console.warn('DLO: initial notification refresh failed', e.message);
	});
}
chrome.runtime.onStartup.addListener(yairStartNotifier);
chrome.runtime.onInstalled.addListener(yairStartNotifier);
// Make sure the alarm matches the setting whenever the background context starts
yairStorage.ready.then(function () {
	yairMigratePollingDefault();
	yairNotifications.schedule();
});
