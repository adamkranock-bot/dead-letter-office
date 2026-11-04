// Page shell: layout, overlays, loading and notification messages, and the favicon.
(function ($) {
	Object.assign(dlo.view, {
		setFavicon: function () {
			var icon = '16.png';
			$('head link[rel="shortcut icon"]').remove();
			var link = document.createElement('link');
			link.type = 'image/png';
			link.rel = 'shortcut icon';
			link.href = chrome.runtime.getURL('images/icons/' + icon);
			document.querySelector('head').appendChild(link);
		}
		, initLayout: function () {
			//  Set page title
			if (!dlo.cfg.data.pageTitle || dlo.cfg.data.pageTitle === 'Reddit - YAIR') dlo.cfg.data.pageTitle = 'Dead Letter Office';
			document.title = dlo.cfg.data.pageTitle;
			// Establish container for saved DOM elements
			dlo.$e = {
				body: $('body')
				, loading: $('<span class="dlo-loading-icon">')
				, get statusText() {
					var $ele = $('.loading-message .dlo-loading-status');
					if ($ele.length > 0) return $ele;
					var $load = $('.loading-message');
					if ($load.length > 0) {
						return $('<span class="dlo-loading-status">').appendTo($load);
					}
					return $('<div>');
				}
			};
			// "uh" is used to send messages
			dlo.model.uh = dlo.$e.body.find('input[name="uh"]').val();
			// If history.pushState has been used, popstate should trigger a view update
			$(window).on('popstate', dlo.view.update);
			// Create global container
			dlo.$e.content = $('<div class="dlo-content">').appendTo($('body > .content'));
			dlo.$e.overlay = $('<div class="dlo-overlay">').appendTo(dlo.$e.body);
			// Compact Mode
			if (dlo.cfg.data.compactMode) {
				dlo.$e.body.addClass('dlo-compact-mode');
			}
			dlo.view.applyTheme();
			// Load page content
			dlo.$e.content.html(dlo.templates.inbox_layout);
			dlo.$e.mainPanel = $('.dlo-inbox-panel');
			dlo.$e.search = $('#DLOSearchInput');
			dlo.$e.searchBtn = $('#DLOSearchButton');
			// Rebind the inbox / saved / archived buttons
			// So that the entire page wont have to be redownloaded
			dlo.$e.content.find('a.dlo-link').on('click', function (e) {
				var url = $(this).attr('href');
				var refresh = (!location.search && location.pathname === url);
				dlo.$e.search.val('');
				$('#select-all').prop("checked", false);
				$(".dlo-sidebar-options").addClass("dlo-hide");
				e.preventDefault();
				if (refresh) {
					dlo.controller.reloadInbox();
				}
				else {
					history.pushState({}, dlo.cfg.data.pageTitle, url);
					dlo.view.update();
				}
			});
			// Bind our searchbar: results update as you type
			var $clear = $('#DLOSearchClear');
			var syncClear = function () {
				$clear.toggleClass('dlo-hide', !dlo.$e.search.val());
			};
			var liveSearch = (function () {
				var timer = null;
				return function () {
					clearTimeout(timer);
					timer = setTimeout(function () {
						dlo.controller.search(dlo.$e.search.val(), true);
					}, 250);
				};
			})();
			dlo.$e.searchBtn.on('click', function () {
				dlo.controller.search(dlo.$e.search.val());
			});
			dlo.$e.search.on('input', function () {
				syncClear();
				liveSearch();
			});
			dlo.$e.search.on('keydown', function (e) {
				if (e.key === 'Enter') dlo.controller.search(dlo.$e.search.val());
				if (e.key === 'Escape') {
					dlo.controller.clearSearch();
					dlo.$e.search.blur();
				}
			});
			$clear.on('click', function () {
				dlo.controller.clearSearch();
				dlo.$e.search.trigger('focus');
			});
			dlo.view.bindKeyboard();
			dlo.model.listOptions.sort = dlo.cfg.data.listSort || 'newest';
			dlo.view.initListToolbar();
			// If the URL includes a search, place the search in the search bar
			if (dlo._get.search) {
				dlo.$e.search.val(decodeURIComponent(dlo._get.search));
			}
			$('#DLOSearchClear').toggleClass('dlo-hide', !dlo.$e.search.val());
			if ( !$("#new_modmail").length && !$("#modmail").length) {
				$(".dlo-modmail").css("display","none");
			}
		}
		, showOverlay: function (clickToDismiss, dismissCallback) {
			dlo.model.cache.hideOverlay = false;
			dlo.$e.overlay.show();
			setTimeout(function () {
				dlo.$e.overlay.addClass('show');
			}, 10);
			if (typeof clickToDismiss === "boolean" && clickToDismiss) {
				setTimeout(function () {
					dlo.$e.overlay.children().on('click', stopEvent);
					dlo.$e.overlay.on('click', function () {
						if (typeof dismissCallback === 'function') dismissCallback();
						dlo.view.hideOverlay();
					});
				}, 10);
			}
		}
		, hideOverlay: function () {
			dlo.model.cache.hideOverlay = true;
			setTimeout(function () {
				if (!dlo.model.cache.hideOverlay) return;
				dlo.$e.overlay.off().removeClass('show');
				setTimeout(function () {
					if (!dlo.model.cache.hideOverlay) return;
					dlo.$e.overlay.hide();
				}, 600);
			}, 50);
		}
		, isLoading: function () {
			return $('.dlo-overlay.show .loading-message').length > 0;
		}
		, showLoading: function (message) {
			if (message === undefined) message = 'Loading';
			var $element;
			if (dlo.view.isLoading()) {
				$element = $('.dlo-overlay.show .loading-message').text(message).prepend(dlo.$e.loading.clone());
			}
			else {
				$element = $('<div class="loading-message">').text(message).prepend(dlo.$e.loading.clone()).appendTo(dlo.$e.overlay.empty());
				dlo.view.showOverlay();
			}
			return $element;
		}
		, showNotification: function (message, duration) {
			if (typeof duration === "undefined") duration = 1500;
			if (message === undefined) message = 'Loading';
			$('<div class="notification-message">').text(message).appendTo(dlo.$e.overlay.empty());
			dlo.$e.overlay.show().addClass('show');
			if (duration < 0) return;
			setTimeout(function () {
				dlo.view.hideOverlay();
			}, duration);
		}
		, showStatus: function (statusMsg) {
			if (statusMsg !== false) {
				dlo.$e.statusText.text(statusMsg);
			}
			else {
				dlo.view.hideOverlay();
				setTimeout(function () {
					dlo.view.showNotification("The system failed too many times in retrieving messages, please try again at a later time.");
				}, 1000);
			}
		}
	});
})(jQuery);
