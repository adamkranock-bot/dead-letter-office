// Single message router for the background context.
//
// Content scripts call background functions with
//   {action: 'proxyCmd', username, path: ['yair', 'db', 'get'], params: [...]}
// Only the paths listed in PROXY_WHITELIST can be called; previously any
// function reachable from `window` could be invoked.
(function () {
	var PROXY_WHITELIST = [
		'yair.cfg_get'
		, 'yair.cfg_set'
		, 'yair.cfg_import'
		, 'yair.db.init'
		, 'yair.db.clearObjectStore'
		, 'yair.db.countObjectsInStore'
		, 'yair.db.get'
		, 'yair.db.add'
		, 'yair.db.addAll'
		, 'yair.db.update'
		, 'yair.db.updateAll'
		, 'yair_cfg_deleted.add'
		, 'yair_cfg_deleted.remove'
		, 'yair_cfg_saved.add'
		, 'yair_cfg_saved.remove'
		, 'drafts.getAllKeys'
		, 'drafts.get'
		, 'drafts.set'
		, 'drafts.delete'
	];
	// Reddit usernames: 3-20 chars of letters, digits, _ and -. Allow a little slack.
	var USERNAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

	function resolvePath(path) {
		var target = self;
		var context = null;
		for (var i = 0; i < path.length; i++) {
			context = target;
			target = target ? target[path[i]] : undefined;
		}
		return typeof target === 'function' ? target : null;
	}

	function errorResponse(e) {
		return {
			__yairError: (e && e.message) ? e.message : String(e)
		};
	}

	function handleProxyCmd(request, sendResponse) {
		if (!(request.path instanceof Array) || PROXY_WHITELIST.indexOf(request.path.join('.')) < 0) {
			return sendResponse(errorResponse('Not allowed: ' + request.path));
		}
		if (!USERNAME_RE.test(request.username || '')) {
			return sendResponse(errorResponse('Missing or invalid username'));
		}
		var func = resolvePath(request.path);
		if (!func) {
			return sendResponse(errorResponse('No such function: ' + request.path.join('.')));
		}
		var responded = false;
		var context = {
			username: request.username
			, callback: function () {
				if (responded) return;
				responded = true;
				sendResponse(Array.prototype.slice.call(arguments));
			}
		};
		var params = (request.params instanceof Array) ? request.params : [];
		var result;
		try {
			result = func.apply(context, params);
		}
		catch (e) {
			console.error('DLO: proxy call failed', request.path.join('.'), e);
			return sendResponse(errorResponse(e));
		}
		if (result && typeof result.then === 'function') {
			result.then(function (value) {
				context.callback(value);
			}, function (e) {
				console.error('DLO: proxy call failed', request.path.join('.'), e);
				if (!responded) {
					responded = true;
					sendResponse(errorResponse(e));
				}
			});
		}
		else if (typeof result !== 'undefined') {
			context.callback(result);
		}
		// Otherwise the function will call this.callback() itself
	}

	chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
		if (!request || request.target === 'offscreen') return;
		if (sender.id && sender.id !== chrome.runtime.id) return;
		if (request.action === 'proxyCmd') {
			yairStorage.ready.then(function () {
				handleProxyCmd(request, sendResponse);
			});
			return true;
		}
		if (Object.prototype.hasOwnProperty.call(actions, request.action)) {
			yairStorage.ready.then(function () {
				return actions[request.action](request);
			}).then(function (result) {
				sendResponse(result);
			}, function (e) {
				console.warn('DLO: action failed', request.action, e.message);
				sendResponse(errorResponse(e));
			});
			return true;
		}
	});
})();
