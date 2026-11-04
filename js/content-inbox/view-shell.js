// Page shell: layout, overlays, loading and notification messages, and the favicon.
(function ($) {
	Object.assign(yair.view, {
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
			if (!yair.cfg.data.pageTitle || yair.cfg.data.pageTitle === 'Reddit - YAIR') yair.cfg.data.pageTitle = 'Dead Letter Office';
			document.title = yair.cfg.data.pageTitle;
			// Establish container for saved DOM elements
			yair.$e = {
				body: $('body')
				, loading: $('<span class="yair-loading-icon">')
				, get statusText() {
					var $ele = $('.loading-message .yair-loading-status');
					if ($ele.length > 0) return $ele;
					var $load = $('.loading-message');
					if ($load.length > 0) {
						return $('<span class="yair-loading-status">').appendTo($load);
					}
					return $('<div>');
				}
			};
			// "uh" is used to send messages
			yair.model.uh = yair.$e.body.find('input[name="uh"]').val();
			// If history.pushState has been used, popstate should trigger a view update
			$(window).on('popstate', yair.view.update);
			// Create global container
			yair.$e.content = $('<div class="yair-content">').appendTo($('body > .content'));
			yair.$e.overlay = $('<div class="yair-overlay">').appendTo(yair.$e.body);
			// Compact Mode
			if (yair.cfg.data.compactMode) {
				yair.$e.body.addClass('yair-compact-mode');
			}
			yair.view.applyTheme();
			// Load page content
			yair.$e.content.html(yair.templates.inbox_layout);
			yair.$e.mainPanel = $('.yair-inbox-panel');
			yair.$e.search = $('#YAIRSearchInput');
			yair.$e.searchBtn = $('#YAIRSearchButton');
			// Rebind the inbox / saved / archived buttons
			// So that the entire page wont have to be redownloaded
			yair.$e.content.find('a.yair-link').on('click', function (e) {
				var url = $(this).attr('href');
				var refresh = (!location.search && location.pathname === url);
				yair.$e.search.val('');
				$('#select-all').prop("checked", false);
				$(".yair-sidebar-options").addClass("yair-hide");
				e.preventDefault();
				if (refresh) {
					yair.controller.reloadInbox();
				}
				else {
					history.pushState({}, yair.cfg.data.pageTitle, url);
					yair.view.update();
				}
			});
			// Bind our searchbar: results update as you type
			var $clear = $('#YAIRSearchClear');
			var syncClear = function () {
				$clear.toggleClass('yair-hide', !yair.$e.search.val());
			};
			var liveSearch = (function () {
				var timer = null;
				return function () {
					clearTimeout(timer);
					timer = setTimeout(function () {
						yair.controller.search(yair.$e.search.val(), true);
					}, 250);
				};
			})();
			yair.$e.searchBtn.on('click', function () {
				yair.controller.search(yair.$e.search.val());
			});
			yair.$e.search.on('input', function () {
				syncClear();
				liveSearch();
			});
			yair.$e.search.on('keydown', function (e) {
				if (e.key === 'Enter') yair.controller.search(yair.$e.search.val());
				if (e.key === 'Escape') {
					yair.controller.clearSearch();
					yair.$e.search.blur();
				}
			});
			$clear.on('click', function () {
				yair.controller.clearSearch();
				yair.$e.search.trigger('focus');
			});
			yair.view.bindKeyboard();
			yair.model.listOptions.sort = yair.cfg.data.listSort || 'newest';
			yair.view.initListToolbar();
			// If the URL includes a search, place the search in the search bar
			if (yair._get.search) {
				yair.$e.search.val(decodeURIComponent(yair._get.search));
			}
			$('#YAIRSearchClear').toggleClass('yair-hide', !yair.$e.search.val());
			if ( !$("#new_modmail").length && !$("#modmail").length) {
				$(".yair-modmail").css("display","none");
			}
		}
		, showOverlay: function (clickToDismiss, dismissCallback) {
			yair.model.cache.hideOverlay = false;
			yair.$e.overlay.show();
			setTimeout(function () {
				yair.$e.overlay.addClass('show');
			}, 10);
			if (typeof clickToDismiss === "boolean" && clickToDismiss) {
				setTimeout(function () {
					yair.$e.overlay.children().on('click', stopEvent);
					yair.$e.overlay.on('click', function () {
						if (typeof dismissCallback === 'function') dismissCallback();
						yair.view.hideOverlay();
					});
				}, 10);
			}
		}
		, hideOverlay: function () {
			yair.model.cache.hideOverlay = true;
			setTimeout(function () {
				if (!yair.model.cache.hideOverlay) return;
				yair.$e.overlay.off().removeClass('show');
				setTimeout(function () {
					if (!yair.model.cache.hideOverlay) return;
					yair.$e.overlay.hide();
				}, 600);
			}, 50);
		}
		, isLoading: function () {
			return $('.yair-overlay.show .loading-message').length > 0;
		}
		, showLoading: function (message) {
			if (message === undefined) message = 'Loading';
			var $element;
			if (yair.view.isLoading()) {
				$element = $('.yair-overlay.show .loading-message').text(message).prepend(yair.$e.loading.clone());
			}
			else {
				$element = $('<div class="loading-message">').text(message).prepend(yair.$e.loading.clone()).appendTo(yair.$e.overlay.empty());
				yair.view.showOverlay();
			}
			return $element;
		}
		, showNotification: function (message, duration) {
			if (typeof duration === "undefined") duration = 1500;
			if (message === undefined) message = 'Loading';
			$('<div class="notification-message">').text(message).appendTo(yair.$e.overlay.empty());
			yair.$e.overlay.show().addClass('show');
			if (duration < 0) return;
			setTimeout(function () {
				yair.view.hideOverlay();
			}, duration);
		}
		, showStatus: function (statusMsg) {
			if (statusMsg !== false) {
				yair.$e.statusText.text(statusMsg);
			}
			else {
				yair.view.hideOverlay();
				setTimeout(function () {
					yair.view.showNotification("The system failed too many times in retrieving messages, please try again at a later time.");
				}, 1000);
			}
		}
	});
})(jQuery);
