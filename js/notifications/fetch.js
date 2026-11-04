// Toolbar popup: lists unread private messages and opens them in YAIR.
// All message text is inserted with textContent, never as HTML.
(function () {
	var container = document.getElementById('notifications');
	var refreshButton = document.querySelector('.forceRefresh');

	function el(tag, className, text) {
		var e = document.createElement(tag);
		if (className) e.className = className;
		if (text !== undefined) e.textContent = text;
		return e;
	}

	// Truncate to `length` characters, ending on a whole word
	function truncate(text, length) {
		text = String(text || '');
		if (text.length <= length) return text;
		text = text.substring(0, length);
		var lastSpace = text.lastIndexOf(' ');
		if (lastSpace > length / 2) text = text.substring(0, lastSpace);
		return text + '…';
	}

	function conversationUrl(data) {
		var first = data.first_message_name || ('t4_' + data.id);
		return 'https://old.reddit.com/message/yair_conversation/' + encodeURIComponent(first);
	}

	function showEmpty(message) {
		container.textContent = '';
		var box = el('div', 'no-notifications');
		box.appendChild(el('h4', null, message || 'No notifications'));
		container.appendChild(box);
	}

	function showError(message) {
		var box = el('div', 'notifications-error', message);
		container.insertBefore(box, container.firstChild);
	}

	function display(notifications) {
		var children = (notifications && notifications.data && notifications.data.children) || [];
		var pms = children.filter(function (item) {
			return item.kind === 't4';
		});
		if (!pms.length) return showEmpty();
		container.textContent = '';
		pms.forEach(function (item) {
			var data = item.data;
			var row = el('div', 'notification group');
			row.tabIndex = 0;
			row.setAttribute('role', 'link');
			row.dataset.id = data.name;
			row.dataset.readUrl = conversationUrl(data);
			var title = el('h4');
			title.id = 'tagline';
			title.appendChild(el('span', 'author', data.author ? data.author : '#' + (data.subreddit || '')));
			title.appendChild(document.createTextNode(' • '));
			title.appendChild(el('span', 'subjectLine', truncate(data.subject, 60)));
			title.appendChild(el('div', 'date', yairTime.fromNow(data.created_utc)));
			row.appendChild(title);
			row.appendChild(el('div', 'body', truncate(data.body, 256)));
			container.appendChild(row);
		});
	}

	function refresh() {
		refreshButton.classList.add('spin');
		setTimeout(function () {
			// Spin at least one full turn
			refreshButton.classList.remove('spin');
		}, 1500);
		chrome.runtime.sendMessage({
			action: 'updateNotifications'
		}, function (response) {
			if (chrome.runtime.lastError || !response || response.__yairError) {
				var reason = chrome.runtime.lastError ? chrome.runtime.lastError.message : (response ? response.__yairError : 'no response');
				showError("Couldn't reach Reddit (" + reason + "). Are you logged in?");
				return;
			}
			display(response);
		});
	}

	function open(row) {
		var notifications = cache;
		var modhash = notifications && notifications.data ? notifications.data.modhash : '';
		var url = row.dataset.readUrl;
		row.remove();
		if (!container.querySelector('.notification')) showEmpty();
		chrome.runtime.sendMessage({
			action: 'markAsRead'
			, name: row.dataset.id
			, modhash: modhash
		}, function () {
			// Ignore failures here; opening the conversation marks it read too
			void chrome.runtime.lastError;
			chrome.tabs.create({
				url: url
			});
		});
	}

	var cache = null;
	container.addEventListener('click', function (event) {
		var row = event.target.closest('.notification');
		if (row) open(row);
	});
	container.addEventListener('keydown', function (event) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		var row = event.target.closest('.notification');
		if (row) {
			event.preventDefault();
			open(row);
		}
	});
	refreshButton.addEventListener('click', refresh);

	// Show the cached list straight away, then refresh it if we have nothing
	chrome.storage.local.get(['notifications'], function (items) {
		cache = items && items.notifications;
		if (cache) {
			display(cache);
		}
		else {
			refresh();
		}
	});
	chrome.storage.onChanged.addListener(function (changes, area) {
		if (area === 'local' && changes.notifications) {
			cache = changes.notifications.newValue;
		}
	});
})();
