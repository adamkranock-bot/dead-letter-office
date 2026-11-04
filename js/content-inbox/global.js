var yair = {
	init: {
		funcs: []
		, waitingCallbacks: []
		, completed: []
	}
	, cfg: {
		data: {}
	}
	, proxy: function (path, params, callback) {
		if (typeof callback === "undefined") callback = function () {};
		if (typeof params === "undefined") params = [];
		else if (!(params instanceof Array)) params = [params];
		// Add username to cmdObj
		var cmdObj = {
			action: "proxyCmd"
			, username: getUsername()
			, path: path
			, params: params
		};
		if (!cmdObj.username) {
			console.error("yair.proxy(...); requires the username (from DOM) for most features");
		}
		yair.sendToBackground(cmdObj, function (response) {
			if (!response || response.__yairError) {
				var message = response ? response.__yairError : 'No response from the extension';
				console.error("DLO background call " + path.join('.') + " failed:", message);
				yair.reportBackgroundProblem(message);
				return;
			}
			callback.apply(this, response);
		});
	}
	// Send a plain {action: ...} request to the background (network calls etc.)
	, request: function (action, data, callback) {
		var msg = Object.assign({}, data || {}, {
			action: action
		});
		yair.sendToBackground(msg, function (response) {
			if (typeof callback === "function") callback(response);
		});
	}
	// Message the background, retrying when its service worker was stopped or
	// restarted mid-call (Chrome does this to idle workers). Every background
	// call is safe to repeat. Calls back with the response, or {__yairError}.
	, sendToBackground: function (msg, callback, attempt) {
		attempt = attempt || 0;
		var TRANSIENT = /message channel closed|message port closed|Receiving end does not exist|Could not establish connection/i;
		var fail = function (message) {
			callback({
				__yairError: message
			});
		};
		if (!yair.extensionAlive()) return fail(yair.CONTEXT_GONE);
		try {
			chrome.runtime.sendMessage(msg, function (response) {
				var err = chrome.runtime.lastError;
				if (err) {
					if (TRANSIENT.test(err.message) && attempt < 3) {
						setTimeout(function () {
							yair.sendToBackground(msg, callback, attempt + 1);
						}, 300 * (attempt + 1));
						return;
					}
					return fail(yair.extensionAlive() ? err.message : yair.CONTEXT_GONE);
				}
				callback(response);
			});
		}
		catch (e) {
			// Thrown synchronously once the extension has been reloaded or removed
			fail(yair.extensionAlive() ? (e && e.message) || String(e) : yair.CONTEXT_GONE);
		}
	}
	, CONTEXT_GONE: 'context-gone'
	// False once the extension has been reloaded, updated, or removed under this page
	, extensionAlive: function () {
		try {
			return !!(chrome.runtime && chrome.runtime.id);
		}
		catch (e) {
			return false;
		}
	}
	, reportBackgroundProblem: function (message) {
		if (!(yair.view && yair.view.showNotification && yair.$e)) return;
		if (message === yair.CONTEXT_GONE) {
			// Stays up: nothing on this page can work until it is reloaded
			yair.view.showNotification("Dead Letter Office was updated or reloaded. Reload this page to keep going.", -1);
			return;
		}
		yair.view.showNotification("Dead Letter Office couldn't finish that (" + message + "). Reload the page if this keeps happening.", 5000);
	}
	, helper: {}
	, manifest: chrome.runtime.getManifest()
};
// Register the bundled typefaces. Done from script so the font URLs resolve
// in both Chrome (chrome-extension://) and Firefox (moz-extension://).
(function () {
	if (typeof FontFace === 'undefined' || !document.fonts) return;
	[
		['DLO Public Sans', 'public-sans-latin-400-normal', '400', 'normal']
		, ['DLO Public Sans', 'public-sans-latin-500-normal', '500', 'normal']
		, ['DLO Public Sans', 'public-sans-latin-600-normal', '600', 'normal']
		, ['DLO Public Sans', 'public-sans-latin-700-normal', '700', 'normal']
		, ['DLO Literata', 'literata-latin-400-normal', '400', 'normal']
		, ['DLO Literata', 'literata-latin-400-italic', '400', 'italic']
		, ['DLO Literata', 'literata-latin-600-normal', '600', 'normal']
	].forEach(function (f) {
		var face = new FontFace(f[0], 'url("' + chrome.runtime.getURL('fonts/' + f[1] + '.woff2') + '") format("woff2")', {
			weight: f[2]
			, style: f[3]
			, display: 'swap'
		});
		document.fonts.add(face);
		face.load().catch(function () {});
	});
})();
(function ($, undefined) {
	yair.functions = {};
	var startTime;

	function checkCallbacksReady() {
		var callbacks = yair.init.waitingCallbacks;
		var completed = yair.init.completed;
		callbackLoop: for (var i = 0; i < callbacks.length; i++) {
			var keys = callbacks[i].keys;
			var callback = callbacks[i].callback;
			for (var j = 0; j < keys.length; j++) {
				if (completed.indexOf(keys[j]) < 0) continue callbackLoop;
			}
			callbacks.splice(i--, 1);
			callback();
		}
	}
	// Start executing all functions that can be preloaded
	yair.init.start = function () {
		startTime = getTime();
		for (var i = 0; i < yair.init.funcs.length; i++) {
			yair.init.funcs[i]();
		}
	};
	// An init function calls this function when it is done
	// The 'key' parameter is the name of the function
	yair.init.done = function (key) {
		yair.init.completed.push(key);
		checkCallbacksReady();
	};
	// Call this function and pass the names of the functions in an array
	// and a callback that needs to execute after those functions are done
	yair.init.executeAfter = function (keys, callback) {
		if (typeof keys === "string") keys = [keys];
		yair.init.waitingCallbacks.push({
			keys: keys
			, callback: callback
		});
		checkCallbacksReady();
	};
	// Wait until the DOM is ready
	yair.functions.DOMReady = function () {
		$(function () {
			yair.init.done("DOMReady");
		});
		return false;
	};
	// Preload HTML templates
	yair.templates = {
		add: function (obj) {
			var objKeys = Object.keys(obj);
			for (var i = 0; i < objKeys.length; i++) {
				var k = objKeys[i];
				yair.templates[k] = obj[k];
			}
		}
	};
	yair.functions.preloadTemplatesReady = function () {
		var tArray = Object.keys(yair.templates);
		var loadedTemplates = 0;
		for (var i = 0; i < tArray.length; i++) {
			(function (template) {
				var url = yair.templates[template];
				if (typeof url !== "string") {
					return ++loadedTemplates;
				}
				$.get(url).done(function (html) {
					yair.templates[template] = html;
				}).always(function () {
					if (++loadedTemplates >= tArray.length) {
						yair.init.done("preloadTemplatesReady");
					}
				});
			})(tArray[i]);
		}
		return false;
	};
	// Note: This function requires DOMReady because it requires getUsername() for yair.proxy()
	yair.functions.initConfig = function (callback) {
		yair.proxy(['yair', 'cfg_get'], [], function (cfg) {
			if (!cfg.doImport) {
				yair.cfg.data = cfg;
			}
			else {
				// An import needs to be attempted
				if (typeof localStorage['YAIR_CONFIG'] !== "undefined") {
					// There is something to import
					yair.cfg.data = JSON.parse(localStorage['YAIR_CONFIG']);
					//console.log("Importing old data");
				}
				else {
					// There is nothing to import
					yair.cfg.data = cfg;
				}
				yair.cfg.data.doImport = false;
				yair.proxy(['yair', 'cfg_import'], yair.cfg.data);
			}
			yair.init.done("CFGReady");
			if (typeof callback === "function") callback();
		});
	};
})(jQuery);