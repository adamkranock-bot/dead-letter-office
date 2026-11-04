// Controller for navigation and actions: opening conversations, search, folders, and archive/save/read actions.
(function ($) {
	Object.assign(yair.controller, {
		showMessageClick: function () {
			var conversation = $(this).data('conversation');
			yair.model.cache.listUrl = location.pathname + location.search;
			yair.model.cache.activeSearch = yair._get.searchObj || null;
			history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_conversation/' + conversation.id);
			yair.controller.parseUrl();
			yair.view.showConversation(conversation);
			// Scroll to the top
			window.scrollTo(0, 0);
		}
		, reloadInbox: function () {
			yair.view.showLoading();
			yair.model.updateDb(function () {
				yair.view.update();
				yair.view.setFavicon();
			}, function (errorMessage) {
				console.error("DB has NOT been updated", arguments);
				yair.view.indexingFailed(errorMessage);
			});
		}
		// Searches within the current folder. Live (as-you-type) searches replace
		// the history entry instead of adding one per keystroke.
		, search: function (query, live) {
			var folder = (yair.show && yair.show !== 'conversation') ? location.pathname : '/message/dlo_inbox';
			var url = query ? folder + '?search=' + encodeURIComponent(query) : folder;
			if (url === location.pathname + location.search) return;
			history[live ? 'replaceState' : 'pushState']({}, yair.cfg.data.pageTitle, url);
			yair.view.update();
		}
		, clearListFilters: function () {
			var opts = yair.model.listOptions;
			opts.min = opts.max = opts.year = opts.lastFrom = null;
			yair.view.rerenderList();
		}
		, clearSearch: function () {
			yair.$e.search.val('');
			$('#YAIRSearchClear').addClass('yair-hide');
			yair.controller.search('', true);
		}
		// Leave a conversation for the folder it was opened from
		, backToList: function () {
			yair.model.cache.activeSearch = null;
			yair.model.cache.findStep = null;
			if (yair.model.cache.listUrl) {
				history.pushState({}, yair.cfg.data.pageTitle, yair.model.cache.listUrl);
				yair.view.update();
			}
			else {
				history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_inbox');
				yair.view.update();
			}
		}
		, parseUrl: function () {
			delete yair['showid'];
			// Old YAIR addresses (/message/yair_*) still work; show the new ones
			if (/^\/message\/yair_/.test(location.pathname)) {
				history.replaceState(history.state, document.title, location.pathname.replace('/message/yair_', '/message/dlo_') + location.search);
			}
			var pathParts = location.pathname.split('/');
			var page = String(pathParts[2] || '').replace(/^(yair|dlo)_/, '');
			if (page === "conversation" && pathParts.length >= 4) {
				yair.show = "conversation";
				yair.showid = pathParts[3];
			}
			else if (page === "modarchived") { window.scrollTo(0, 0); yair.show = "modarchived"; }
			else if (page === "modsaved") { window.scrollTo(0, 0); yair.show = "modsaved"; }
			else if (page === "modmail") { window.scrollTo(0, 0); yair.show = "modmail"; }
			else if (page === "saved") { window.scrollTo(0, 0); yair.show = "saved"; }
			else if (page === "archived") { window.scrollTo(0, 0); yair.show = "archived"; }
			else { window.scrollTo(0, 0); yair.show = "inbox"; }
			yair._get = parseQueryString(location.search);
			if (yair._get.search) {
				var raw = yair._get.search;
				try { raw = decodeURIComponent(raw); } catch (e) {}
				yair._get.searchObj = yair.search.parse(raw, getUsername());
			}
			else if (yair._get.searchObj) {
				delete yair._get['searchObj'];
			}
		}
		, action: {
			get conversations() {
				if (yair.show === "conversation") {
					return [$('.yair-conversation').data('conversation')];
				}
				else if (['inbox', 'saved', 'archived', 'modmail', 'modsaved', 'modarchived'].indexOf(yair.show) >= 0) {
					var conversations = [];
					var $checked = $('.yair-message-row .yair-checkbox input[type="checkbox"]:checked');
					$checked.each(function () {
						var $row = $(this).closest('.yair-message-row');
						var conversation = $row.data('conversation');
						conversation.$e = $row;
						conversations.push(conversation);
					});
					return conversations;
				}
			}
			, toggleSave: function (e) {
				var $ele = $(this);
				var id;
				if (yair.show === "conversation") {
					id = $ele.closest('.yair-conversation').data('conversation').id;
				}
				else {
					id = $ele.closest('.yair-message-row').data('conversation').id;
				}
				if ($ele.hasClass('yair-saved')) {
					yair.cfg.saved.remove(id);
					$ele.removeClass('yair-saved');
				}
				else {
					yair.cfg.saved.add(id);
					$ele.addClass('yair-saved');
				}
				e.stopPropagation();
			}
			, delete: function () {
				var conversation = $(this);
				var id;
				if (yair.show === "conversation") {
					id = conversation.closest('.yair-conversation').data('conversation').id;
				}
				else {
					id = conversation.closest('.yair-message-row').data('conversation').id;
				}				
				if (!yair.cfg.deleted.contains(id)) {
					yair.cfg.deleted.add(id);
					conversation.closest(".yair-message-row").find('.styled-checkbox').prop("checked", false);
					if (yair.show !== "archived" && yair.show !== "modarchived") {
						conversation.closest('.yair-message-row').slideUp(function () {
							conversation.closest('.yair-message-row').remove();
						});
					}
				}
				yair.view.showNotification('Archived');
				if (yair.show === "conversation") {
					// Go to inbox
					history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_inbox');
					yair.view.update();
				}
				if(!$('.yair-main-panel .styled-checkbox').is(":checked")) {
					$(".yair-sidebar-options").addClass("yair-hide");
				}
			}
			, bulkDelete: function () {
				var conversations = yair.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					var id = conversation.id;
					if (!yair.cfg.deleted.contains(id)) {
						yair.cfg.deleted.add(id);
						if (yair.show !== "conversation" && yair.show !== "archived" && yair.show !== "modarchived") {
							conversation.$e.slideUp(function () {
								conversation.$e.remove();
							});
						}
					}
				}
				$(".yair-sidebar-options").addClass("yair-hide");
				if (!conversations.length) return;
				yair.view.showNotification('Archived');
				if (yair.show === "conversation") {
					// Go to inbox
					history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_inbox');
					yair.view.update();
				}
				$('.styled-checkbox').prop('checked', false);
			}
			, restore: function (e) {
				var conversation = $(this);
				var id;
				if (yair.show === "conversation") {
					id = conversation.closest('.yair-conversation').data('conversation').id;
				}
				else {
					id = conversation.closest('.yair-message-row').data('conversation').id;
				}
				if (yair.cfg.deleted.contains(id)) {
					yair.cfg.deleted.remove(id);
					conversation.closest(".yair-message-row").find('.styled-checkbox').prop("checked", false);
					if (yair.show === "archived" || yair.show === "modarchived") {
						conversation.closest('.yair-message-row').slideUp(function () {
							conversation.closest('.yair-message-row').remove();
						});
					}
				}
				if(!$('.yair-main-panel .styled-checkbox').is(":checked")) {
					$(".yair-sidebar-options").addClass("yair-hide");
				}
				yair.view.showNotification('Restored');
				if (yair.show === "conversation") {
					// Go to inbox
					history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_inbox');
					yair.view.update();
				}
			}
			, bulkRestore: function () {
				var conversations = yair.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					var id = conversation.id;
					if (yair.cfg.deleted.contains(id)) {
						yair.cfg.deleted.remove(id);
						if (yair.show === "archived" || yair.show === "modarchived") {
							conversation.$e.slideUp(function () {
								conversation.$e.remove();
							});
						}
					}
				}
				$(".yair-sidebar-options").addClass("yair-hide");
				if (!conversations.length) return;
				yair.view.showNotification('Restored');
				if (yair.show === "conversation") {
					// Go to inbox
					history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_inbox');
					yair.view.update();
				}
				$('.styled-checkbox').prop('checked', false);
			}
			, save: function () {
				var conversations = yair.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var id = conversations[i].id;
					if (!yair.cfg.saved.contains(id)) {
						yair.cfg.saved.add(id);
					}
				}
				if (!conversations.length) return;
				var msg = (conversations.length === 1) ? 'The message was saved' : 'The messages were saved';
				yair.view.showNotification(msg);
			}
			, unsave: function () {
				var conversations = yair.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					var id = conversation.id;
					if (yair.cfg.saved.contains(id)) {
						yair.cfg.saved.remove(id);
						if (yair.show === "saved") {
							conversation.$e.slideUp(function () { conversation.$e.remove(); });
						}
					}
				}
				if (!conversations.length) return;
				var msg = (conversations.length === 1) ? 'The message was unsaved' : 'The messages were unsaved';
				yair.view.showNotification(msg);
			}
			, markRead: function () {
				var conversation = $(this).closest('.yair-message-row');
				conversation.removeClass('yair-unread');
				conversation.addClass('yair-read');
				yair.model.setConversationStatus(conversation.data('conversation'), true);
			}
			, markUnread: function () {
				var conversation = $(this).closest('.yair-message-row');
				conversation.addClass('yair-unread');
				conversation.removeClass('yair-read');
				yair.model.setConversationStatus(conversation.data('conversation'), false);
			}
			, bulkMarkRead: function () {
				var conversations = yair.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					if (conversation.$e) {
						conversation.$e.removeClass('yair-unread').addClass('yair-read');
						delete conversation['$e'];
					}
					yair.model.setConversationStatus(conversation, true);
				}
				$(".yair-sidebar-options").addClass("yair-hide");
				if (!conversations.length) return;
				if (yair.show === "conversation") {
					// Go to inbox
					yair.view.showNotification('Marked read');
					history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_inbox');
					yair.view.update();
				}
				else {
					// Deselect selected items
					var $rows = $('.yair-message-row.yair-row-checked');
					$rows.removeClass('yair-row-checked');
					$('.styled-checkbox').prop('checked', false);
				}
			}
			, bulkMarkUnread: function () {
				var conversations = yair.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					if (conversation.$e) {
						conversation.$e.addClass('yair-unread').removeClass('yair-read');
						delete conversation['$e'];
					}
					yair.model.setConversationStatus(conversation, false);
				}
				$(".yair-sidebar-options").addClass("yair-hide");
				if (!conversations.length) return;
				if (yair.show === "conversation") {
					// Go to inbox
					yair.view.showNotification('Marked unread');
					history.pushState({}, yair.cfg.data.pageTitle, '/message/dlo_inbox');
					yair.view.update();
				}
				else {
					// Deselect selected items
					var $rows = $('.yair-message-row.yair-row-checked');
					$rows.removeClass('yair-row-checked');
					$('.styled-checkbox').prop('checked', false);
				}
			}
		}
	});
})(jQuery);
