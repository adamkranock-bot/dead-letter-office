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
		chrome.runtime.sendMessage(cmdObj, function (response) {
			var err = chrome.runtime.lastError;
			if (err || !response || response.__yairError) {
				var message = err ? err.message : (response ? response.__yairError : 'No response from the extension');
				console.error("YAIR background call " + path.join('.') + " failed:", message);
				if (yair.view && yair.view.showNotification && yair.$e) {
					yair.view.showNotification("Something went wrong talking to the YAIR extension: " + message, 5000);
				}
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
		chrome.runtime.sendMessage(msg, function (response) {
			var err = chrome.runtime.lastError;
			if (err) response = {
				__yairError: err.message
			};
			if (typeof callback === "function") callback(response);
		});
	}
	, helper: {}
	, manifest: chrome.runtime.getManifest()
};
// Register the bundled typefaces. Done from script so the font URLs resolve
// in both Chrome (chrome-extension://) and Firefox (moz-extension://).
(function () {
	if (typeof FontFace === 'undefined' || !document.fonts) return;
	[
		['YAIR Public Sans', 'public-sans-latin-400-normal', '400', 'normal']
		, ['YAIR Public Sans', 'public-sans-latin-500-normal', '500', 'normal']
		, ['YAIR Public Sans', 'public-sans-latin-600-normal', '600', 'normal']
		, ['YAIR Public Sans', 'public-sans-latin-700-normal', '700', 'normal']
		, ['YAIR Literata', 'literata-latin-400-normal', '400', 'normal']
		, ['YAIR Literata', 'literata-latin-400-italic', '400', 'italic']
		, ['YAIR Literata', 'literata-latin-600-normal', '600', 'normal']
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