// Starts the archive page once the DOM is ready and the templates are loaded.
// Loaded last: every other content-inbox module has added its part by now.
(function ($) {
	dlo.templates.add({
		inbox_layout: chrome.runtime.getURL('template/inbox_layout.html'),
		inbox_message_row: chrome.runtime.getURL('template/inbox_message_row.html'),
		conversation: chrome.runtime.getURL('template/conversation.html'),
		conversation_reverse: chrome.runtime.getURL('template/conversation_reverse.html'),
		private_message: chrome.runtime.getURL('template/private_message.html'),
		load_more_messages: chrome.runtime.getURL('template/load_more_messages.html'),
		config: chrome.runtime.getURL('template/config.html')
	});
	dlo.init.funcs.push(dlo.functions.DOMReady);
	dlo.init.funcs.push(dlo.functions.preloadTemplatesReady);
	dlo.init.start();
	dlo.init.executeAfter(['DOMReady', 'preloadTemplatesReady'], function () {
		// The DOM is ready and templates have been preloaded
		// Don't do anything if it's a 503
		if (document.title.indexOf("Ow!") >= 0) return;
		if (!isLoggedIn()) return;
		// Parse the URL
		dlo.controller.parseUrl();
		dlo.functions.initConfig(function () {
			// Initialize default layout elements
			dlo.view.setFavicon();
			dlo.view.initLayout(); // To set the page title, we need our config
			dlo.view.bindActionButtons();
			// The notifier polls with the interval of whichever user last opened the archive
			dlo.cfg.set('inboxRefreshInterval', dlo.cfg.data.inboxRefreshInterval);
			dlo.view.showLoading();
			dlo.proxy(['dlo', 'db', 'init'], [], dlo.controller.reloadInbox);
		});
	});
})(jQuery);
