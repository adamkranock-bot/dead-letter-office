// Controller for navigation and actions: opening conversations, search, folders, and archive/save/read actions.
(function ($) {
	Object.assign(dlo.controller, {
		showMessageClick: function () {
			var conversation = $(this).data('conversation');
			dlo.model.cache.listUrl = location.pathname + location.search;
			dlo.model.cache.activeSearch = dlo._get.searchObj || null;
			history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_conversation/' + conversation.id);
			dlo.controller.parseUrl();
			dlo.view.showConversation(conversation);
			// Scroll to the top
			window.scrollTo(0, 0);
		}
		, reloadInbox: function () {
			dlo.view.showLoading();
			dlo.model.updateDb(function () {
				dlo.view.update();
				dlo.view.setFavicon();
			}, function (errorMessage) {
				console.error("DB has NOT been updated", arguments);
				dlo.view.indexingFailed(errorMessage);
			});
		}
		// Searches within the current folder. Live (as-you-type) searches replace
		// the history entry instead of adding one per keystroke.
		, search: function (query, live) {
			var folder = (dlo.show && dlo.show !== 'conversation') ? location.pathname : '/message/dlo_inbox';
			var url = query ? folder + '?search=' + encodeURIComponent(query) : folder;
			if (url === location.pathname + location.search) return;
			history[live ? 'replaceState' : 'pushState']({}, dlo.cfg.data.pageTitle, url);
			dlo.view.update();
		}
		, clearListFilters: function () {
			var opts = dlo.model.listOptions;
			opts.min = opts.max = opts.year = opts.lastFrom = null;
			dlo.view.rerenderList();
		}
		, clearSearch: function () {
			dlo.$e.search.val('');
			$('#DLOSearchClear').addClass('dlo-hide');
			dlo.controller.search('', true);
		}
		// Leave a conversation for the folder it was opened from
		, backToList: function () {
			dlo.model.cache.activeSearch = null;
			dlo.model.cache.findStep = null;
			if (dlo.model.cache.listUrl) {
				history.pushState({}, dlo.cfg.data.pageTitle, dlo.model.cache.listUrl);
				dlo.view.update();
			}
			else {
				history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_inbox');
				dlo.view.update();
			}
		}
		, parseUrl: function () {
			delete dlo['showid'];
			// Old YAIR addresses (/message/yair_*) still work; show the new ones
			if (/^\/message\/yair_/.test(location.pathname)) {
				history.replaceState(history.state, document.title, location.pathname.replace('/message/yair_', '/message/dlo_') + location.search);
			}
			var pathParts = location.pathname.split('/');
			var page = String(pathParts[2] || '').replace(/^(yair|dlo)_/, '');
			if (page === "conversation" && pathParts.length >= 4) {
				dlo.show = "conversation";
				dlo.showid = pathParts[3];
			}
			else if (page === "modarchived") { window.scrollTo(0, 0); dlo.show = "modarchived"; }
			else if (page === "modsaved") { window.scrollTo(0, 0); dlo.show = "modsaved"; }
			else if (page === "modmail") { window.scrollTo(0, 0); dlo.show = "modmail"; }
			else if (page === "saved") { window.scrollTo(0, 0); dlo.show = "saved"; }
			else if (page === "archived") { window.scrollTo(0, 0); dlo.show = "archived"; }
			else { window.scrollTo(0, 0); dlo.show = "inbox"; }
			dlo._get = parseQueryString(location.search);
			if (dlo._get.search) {
				var raw = dlo._get.search;
				try { raw = decodeURIComponent(raw); } catch (e) {}
				dlo._get.searchObj = dlo.search.parse(raw, getUsername());
			}
			else if (dlo._get.searchObj) {
				delete dlo._get['searchObj'];
			}
		}
		, action: {
			get conversations() {
				if (dlo.show === "conversation") {
					return [$('.dlo-conversation').data('conversation')];
				}
				else if (['inbox', 'saved', 'archived', 'modmail', 'modsaved', 'modarchived'].indexOf(dlo.show) >= 0) {
					var conversations = [];
					var $checked = $('.dlo-message-row .dlo-checkbox input[type="checkbox"]:checked');
					$checked.each(function () {
						var $row = $(this).closest('.dlo-message-row');
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
				if (dlo.show === "conversation") {
					id = $ele.closest('.dlo-conversation').data('conversation').id;
				}
				else {
					id = $ele.closest('.dlo-message-row').data('conversation').id;
				}
				if ($ele.hasClass('dlo-saved')) {
					dlo.cfg.saved.remove(id);
					$ele.removeClass('dlo-saved');
				}
				else {
					dlo.cfg.saved.add(id);
					$ele.addClass('dlo-saved');
				}
				e.stopPropagation();
			}
			, delete: function () {
				var conversation = $(this);
				var id;
				if (dlo.show === "conversation") {
					id = conversation.closest('.dlo-conversation').data('conversation').id;
				}
				else {
					id = conversation.closest('.dlo-message-row').data('conversation').id;
				}				
				if (!dlo.cfg.deleted.contains(id)) {
					dlo.cfg.deleted.add(id);
					conversation.closest(".dlo-message-row").find('.styled-checkbox').prop("checked", false);
					if (dlo.show !== "archived" && dlo.show !== "modarchived") {
						conversation.closest('.dlo-message-row').slideUp(function () {
							conversation.closest('.dlo-message-row').remove();
						});
					}
				}
				dlo.view.showNotification('Archived');
				if (dlo.show === "conversation") {
					// Go to inbox
					history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_inbox');
					dlo.view.update();
				}
				if(!$('.dlo-main-panel .styled-checkbox').is(":checked")) {
					$(".dlo-sidebar-options").addClass("dlo-hide");
				}
			}
			, bulkDelete: function () {
				var conversations = dlo.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					var id = conversation.id;
					if (!dlo.cfg.deleted.contains(id)) {
						dlo.cfg.deleted.add(id);
						if (dlo.show !== "conversation" && dlo.show !== "archived" && dlo.show !== "modarchived") {
							conversation.$e.slideUp(function () {
								conversation.$e.remove();
							});
						}
					}
				}
				$(".dlo-sidebar-options").addClass("dlo-hide");
				if (!conversations.length) return;
				dlo.view.showNotification('Archived');
				if (dlo.show === "conversation") {
					// Go to inbox
					history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_inbox');
					dlo.view.update();
				}
				$('.styled-checkbox').prop('checked', false);
			}
			, restore: function (e) {
				var conversation = $(this);
				var id;
				if (dlo.show === "conversation") {
					id = conversation.closest('.dlo-conversation').data('conversation').id;
				}
				else {
					id = conversation.closest('.dlo-message-row').data('conversation').id;
				}
				if (dlo.cfg.deleted.contains(id)) {
					dlo.cfg.deleted.remove(id);
					conversation.closest(".dlo-message-row").find('.styled-checkbox').prop("checked", false);
					if (dlo.show === "archived" || dlo.show === "modarchived") {
						conversation.closest('.dlo-message-row').slideUp(function () {
							conversation.closest('.dlo-message-row').remove();
						});
					}
				}
				if(!$('.dlo-main-panel .styled-checkbox').is(":checked")) {
					$(".dlo-sidebar-options").addClass("dlo-hide");
				}
				dlo.view.showNotification('Restored');
				if (dlo.show === "conversation") {
					// Go to inbox
					history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_inbox');
					dlo.view.update();
				}
			}
			, bulkRestore: function () {
				var conversations = dlo.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					var id = conversation.id;
					if (dlo.cfg.deleted.contains(id)) {
						dlo.cfg.deleted.remove(id);
						if (dlo.show === "archived" || dlo.show === "modarchived") {
							conversation.$e.slideUp(function () {
								conversation.$e.remove();
							});
						}
					}
				}
				$(".dlo-sidebar-options").addClass("dlo-hide");
				if (!conversations.length) return;
				dlo.view.showNotification('Restored');
				if (dlo.show === "conversation") {
					// Go to inbox
					history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_inbox');
					dlo.view.update();
				}
				$('.styled-checkbox').prop('checked', false);
			}
			, save: function () {
				var conversations = dlo.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var id = conversations[i].id;
					if (!dlo.cfg.saved.contains(id)) {
						dlo.cfg.saved.add(id);
					}
				}
				if (!conversations.length) return;
				var msg = (conversations.length === 1) ? 'The message was saved' : 'The messages were saved';
				dlo.view.showNotification(msg);
			}
			, unsave: function () {
				var conversations = dlo.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					var id = conversation.id;
					if (dlo.cfg.saved.contains(id)) {
						dlo.cfg.saved.remove(id);
						if (dlo.show === "saved") {
							conversation.$e.slideUp(function () { conversation.$e.remove(); });
						}
					}
				}
				if (!conversations.length) return;
				var msg = (conversations.length === 1) ? 'The message was unsaved' : 'The messages were unsaved';
				dlo.view.showNotification(msg);
			}
			, markRead: function () {
				var conversation = $(this).closest('.dlo-message-row');
				conversation.removeClass('dlo-unread');
				conversation.addClass('dlo-read');
				dlo.model.setConversationStatus(conversation.data('conversation'), true);
			}
			, markUnread: function () {
				var conversation = $(this).closest('.dlo-message-row');
				conversation.addClass('dlo-unread');
				conversation.removeClass('dlo-read');
				dlo.model.setConversationStatus(conversation.data('conversation'), false);
			}
			, bulkMarkRead: function () {
				var conversations = dlo.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					if (conversation.$e) {
						conversation.$e.removeClass('dlo-unread').addClass('dlo-read');
						delete conversation['$e'];
					}
					dlo.model.setConversationStatus(conversation, true);
				}
				$(".dlo-sidebar-options").addClass("dlo-hide");
				if (!conversations.length) return;
				if (dlo.show === "conversation") {
					// Go to inbox
					dlo.view.showNotification('Marked read');
					history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_inbox');
					dlo.view.update();
				}
				else {
					// Deselect selected items
					var $rows = $('.dlo-message-row.dlo-row-checked');
					$rows.removeClass('dlo-row-checked');
					$('.styled-checkbox').prop('checked', false);
				}
			}
			, bulkMarkUnread: function () {
				var conversations = dlo.controller.action.conversations;
				for (var i = 0; i < conversations.length; i++) {
					var conversation = conversations[i];
					if (conversation.$e) {
						conversation.$e.addClass('dlo-unread').removeClass('dlo-read');
						delete conversation['$e'];
					}
					dlo.model.setConversationStatus(conversation, false);
				}
				$(".dlo-sidebar-options").addClass("dlo-hide");
				if (!conversations.length) return;
				if (dlo.show === "conversation") {
					// Go to inbox
					dlo.view.showNotification('Marked unread');
					history.pushState({}, dlo.cfg.data.pageTitle, '/message/dlo_inbox');
					dlo.view.update();
				}
				else {
					// Deselect selected items
					var $rows = $('.dlo-message-row.dlo-row-checked');
					$rows.removeClass('dlo-row-checked');
					$('.styled-checkbox').prop('checked', false);
				}
			}
		}
	});
})(jQuery);
