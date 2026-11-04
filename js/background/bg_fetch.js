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
	var DEFAULT_INTERVAL = 60000;

	function intervalMinutes() {
		var ms = +yairStorage.get('inboxRefreshInterval') || DEFAULT_INTERVAL;
		// Chrome won't fire alarms more often than every 30 seconds
		return Math.max(0.5, ms / 60000);
	}

	function schedule() {
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
					console.error('YAIR: could not store new messages for', user, e);
				});
			})).then(function () {
				return data;
			});
		});
	}
	chrome.alarms.onAlarm.addListener(function (alarm) {
		if (alarm.name !== ALARM) return;
		yairStorage.ready.then(update).catch(function (e) {
			console.warn('YAIR: notification refresh failed', e.message);
		});
	});
	return {
		update: update
		, schedule: schedule
		, setBadge: setBadge
		, setRefreshInterval: function (ms) {
			ms = parseInt(ms, 10);
			if (!(ms > 0)) return;
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
	, updateNotifications: function () {
		return yairNotifications.update();
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

function yairStartNotifier() {
	yairStorage.ready.then(function () {
		yairNotifications.schedule();
		return yairNotifications.update();
	}).catch(function (e) {
		console.warn('YAIR: initial notification refresh failed', e.message);
	});
}
chrome.runtime.onStartup.addListener(yairStartNotifier);
chrome.runtime.onInstalled.addListener(yairStartNotifier);
// Make sure the alarm exists whenever the background context starts
yairStorage.ready.then(yairNotifications.schedule);
