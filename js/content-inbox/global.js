var dlo = {
	init: {
		funcs: []
		, waitingCallbacks: []
		, completed: []
	}
	, cfg: {
		data: {}
	}
	// Filled in by the view-*, controller*, model, and dbhelper modules
	, view: {}
	, controller: {}
	, model: {}
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
			console.error("dlo.proxy(...); requires the username (from DOM) for most features");
		}
		dlo.sendToBackground(cmdObj, function (response) {
			if (!response || response.__dloError) {
				var message = response ? response.__dloError : 'No response from the extension';
				console.error("DLO background call " + path.join('.') + " failed:", message);
				dlo.reportBackgroundProblem(message);
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
		dlo.sendToBackground(msg, function (response) {
			if (typeof callback === "function") callback(response);
		});
	}
	// Message the background, retrying when its service worker was stopped or
	// restarted mid-call (Chrome does this to idle workers). Every background
	// call is safe to repeat. Calls back with the response, or {__dloError}.
	, sendToBackground: function (msg, callback, attempt) {
		attempt = attempt || 0;
		var TRANSIENT = /message channel closed|message port closed|Receiving end does not exist|Could not establish connection/i;
		var fail = function (message) {
			callback({
				__dloError: message
			});
		};
		if (!dlo.extensionAlive()) return fail(dlo.CONTEXT_GONE);
		try {
			chrome.runtime.sendMessage(msg, function (response) {
				var err = chrome.runtime.lastError;
				if (err) {
					if (TRANSIENT.test(err.message) && attempt < 3) {
						setTimeout(function () {
							dlo.sendToBackground(msg, callback, attempt + 1);
						}, 300 * (attempt + 1));
						return;
					}
					return fail(dlo.extensionAlive() ? err.message : dlo.CONTEXT_GONE);
				}
				callback(response);
			});
		}
		catch (e) {
			// Thrown synchronously once the extension has been reloaded or removed
			fail(dlo.extensionAlive() ? (e && e.message) || String(e) : dlo.CONTEXT_GONE);
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
		if (!(dlo.view && dlo.view.showNotification && dlo.$e)) return;
		if (message === dlo.CONTEXT_GONE) {
			// Stays up: nothing on this page can work until it is reloaded
			dlo.view.showNotification("Dead Letter Office was updated or reloaded. Reload this page to keep going.", -1);
			return;
		}
		dlo.view.showNotification("Dead Letter Office couldn't finish that (" + message + "). Reload the page if this keeps happening.", 5000);
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
	dlo.functions = {};
	var startTime;

	function checkCallbacksReady() {
		var callbacks = dlo.init.waitingCallbacks;
		var completed = dlo.init.completed;
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
	dlo.init.start = function () {
		startTime = getTime();
		for (var i = 0; i < dlo.init.funcs.length; i++) {
			dlo.init.funcs[i]();
		}
	};
	// An init function calls this function when it is done
	// The 'key' parameter is the name of the function
	dlo.init.done = function (key) {
		dlo.init.completed.push(key);
		checkCallbacksReady();
	};
	// Call this function and pass the names of the functions in an array
	// and a callback that needs to execute after those functions are done
	dlo.init.executeAfter = function (keys, callback) {
		if (typeof keys === "string") keys = [keys];
		dlo.init.waitingCallbacks.push({
			keys: keys
			, callback: callback
		});
		checkCallbacksReady();
	};
	// Wait until the DOM is ready
	dlo.functions.DOMReady = function () {
		$(function () {
			dlo.init.done("DOMReady");
		});
		return false;
	};
	// Preload HTML templates
	dlo.templates = {
		add: function (obj) {
			var objKeys = Object.keys(obj);
			for (var i = 0; i < objKeys.length; i++) {
				var k = objKeys[i];
				dlo.templates[k] = obj[k];
			}
		}
	};
	dlo.functions.preloadTemplatesReady = function () {
		var tArray = Object.keys(dlo.templates);
		var loadedTemplates = 0;
		for (var i = 0; i < tArray.length; i++) {
			(function (template) {
				var url = dlo.templates[template];
				if (typeof url !== "string") {
					return ++loadedTemplates;
				}
				$.get(url).done(function (html) {
					dlo.templates[template] = html;
				}).always(function () {
					if (++loadedTemplates >= tArray.length) {
						dlo.init.done("preloadTemplatesReady");
					}
				});
			})(tArray[i]);
		}
		return false;
	};
	// Note: This function requires DOMReady because it requires getUsername() for dlo.proxy()
	dlo.functions.initConfig = function (callback) {
		dlo.proxy(['dlo', 'cfg_get'], [], function (cfg) {
			if (!cfg.doImport) {
				dlo.cfg.data = cfg;
			}
			else {
				// An import needs to be attempted
				if (typeof localStorage['YAIR_CONFIG'] !== "undefined") {
					// There is something to import
					dlo.cfg.data = JSON.parse(localStorage['YAIR_CONFIG']);
					//console.log("Importing old data");
				}
				else {
					// There is nothing to import
					dlo.cfg.data = cfg;
				}
				dlo.cfg.data.doImport = false;
				dlo.proxy(['dlo', 'cfg_import'], dlo.cfg.data);
			}
			dlo.init.done("CFGReady");
			if (typeof callback === "function") callback();
		});
	};
})(jQuery);