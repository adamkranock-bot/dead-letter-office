// Conversation list: rendering, summary, sort/filter bar, folders, and bulk selection.
(function ($) {
	Object.assign(yair.view, {
		update: function () {
			// Init search from URL
			yair.view.hideOverlay();
			yair.view.showIndexBanner();
			yair.controller.parseUrl();
			yair.view.updateBodyClass();
			if (yair.show === "conversation") {
				// Show this conversation
				yair.model.getConversation(yair.showid, yair.view.showConversation);
			}
			if (['inbox', 'saved', 'archived', 'modmail', 'modsaved', 'modarchived'].indexOf(yair.show) >= 0) {
				// Fetch all conversations and add them to the inbox view
				yair.model.getConversations(yair.view.showInbox);
			}
		}
		, showInbox: function (conversations, hideOverlay) {
			if (typeof hideOverlay !== "boolean") hideOverlay = true;
			// Empty panel
			yair.$e.mainPanel.empty();
			// Cache the fetched conversations
			yair.model.cache.conversations = conversations;
			yair.view.setFavicon();
			(function () {
				// Folder first, so counts like "34 of 276" are relative to the folder you're in
				var folderConversations = conversations.slice();
				yair.model.directoryFilter(folderConversations);
				yair.model.showModmailInInbox(folderConversations);
				yair.view.updateListToolbar(folderConversations);
				var filteredConversations = folderConversations.slice();
				yair.model.searchFilter(filteredConversations);
				yair.model.listFilter(filteredConversations);
				yair.model.sortConversations(filteredConversations);
				yair.$e.mainPanel.empty();
				yair.view.addInboxSummary(folderConversations, filteredConversations);
				yair.model.cache.lastGroup = null;
				yair.model.cache.focusIndex = -1;
				if (!filteredConversations.length) {
					var narrowed = yair._get.searchObj || yair.model.listFiltersActive();
					$('<div class="yair-empty-state">').text(narrowed ? 'No conversations match. Try widening the filters.' : 'Nothing here.').appendTo(yair.$e.mainPanel);
				}
				yair.view.addConversationsToInbox(filteredConversations);
			})();
			// Hide overlay
			if (hideOverlay) yair.view.hideOverlay();
		}
		// "276 conversations · 1,000 messages · Dec 2015 – Mar 2025", or the match count when searching
		, addInboxSummary: function (all, shown) {
			var numberFormat = (typeof Intl !== 'undefined') ? new Intl.NumberFormat() : null;
			var fmt = function (n) { return numberFormat ? numberFormat.format(n) : String(n); };
			var monthYear = function (ts) {
				var d = new Date(ts * 1000);
				return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
			};
			var messages = 0, oldest = Infinity, newest = 0;
			shown.forEach(function (c) {
				messages += c.messages.length;
				c.messages.forEach(function (m) {
					if (m.created_utc && m.created_utc < oldest) oldest = m.created_utc;
					if (m.created_utc > newest) newest = m.created_utc;
				});
			});
			var text;
			var msgText = fmt(messages) + (messages === 1 ? ' message' : ' messages');
			if (yair._get.searchObj || yair.model.listFiltersActive()) {
				text = fmt(shown.length) + ' of ' + fmt(all.length) + ' conversations match, with ' + msgText;
			}
			else {
				text = fmt(shown.length) + (shown.length === 1 ? ' conversation, ' : ' conversations, ') + msgText;
			}
			if (newest) {
				text += monthYear(oldest) === monthYear(newest) ? ' from ' + monthYear(newest) : ' from ' + monthYear(oldest) + ' to ' + monthYear(newest);
			}
			var $summary = $('<div class="yair-summary">').append($('<span>').text(text));
			if (yair._get.searchObj) {
				$('<button class="yair-summary-clear" type="button">').text('Clear search').on('click', yair.controller.clearSearch).appendTo($summary);
			}
			if (yair.model.listFiltersActive()) {
				$('<button class="yair-summary-clear" type="button">').text('Clear filters').on('click', yair.controller.clearListFilters).appendTo($summary);
			}
			$summary.appendTo(yair.$e.mainPanel);
		}
		// Highlight the current search's words inside an element ('subject', 'people', or 'message')
		, highlight: function ($el, part) {
			var q = yair._get.searchObj;
			if (!q || !$el || !$el.length) return;
			yair.search.mark($el[0], yair.search.terms(q, part));
		}
		// Indexing couldn't finish: still show what's stored, with the problem above it
		, indexingFailed: function (message) {
			yair.view.hideOverlay();
			yair.model.cache.indexBanner = message;
			yair.view.update();
		}
		, showIndexBanner: function () {
			$('.dlo-banner').remove();
			var message = yair.model.cache.indexBanner;
			if (!message) return;
			var $banner = $('<div class="dlo-banner" role="alert">');
			$('<span class="dlo-banner-text">').text(message).appendTo($banner);
			$('<button type="button" class="dlo-banner-close" aria-label="Dismiss">').text('\u00d7').on('click', function () {
				yair.model.cache.indexBanner = null;
				$banner.remove();
			}).appendTo($banner);
			$banner.insertBefore('.yair-list-toolbar');
		}
		, addMessageInInbox: function (conversation) {
			var unread = conversation['new']
				, id = conversation.id
				, correspondent = conversation.correspondent
				, subject = conversation.subject
				, message = decodeBasicEntities(conversation.text || '')
				, datetime = conversation.last_update
				, modmail = conversation.modmail;
			var checkboxId = 'yair_cb_' + id;
			var html = replaceAll(yair.templates.inbox_message_row, "{checkboxid}", checkboxId);
			var $row = $(html).appendTo(yair.$e.mainPanel);
			if (conversation.last_author === getUsername()) {
				$row.find('.yair-last-author').addClass('yair-last-sent').attr('title', 'The last message in this thread was sent by you');
			}
			else {
				$row.find('.yair-last-author').addClass('yair-last-received').attr('title', 'The last message in this thread was sent by ' + conversation.last_author);
			}
			$row.find('.yair-message-row-content').attr('data-type', 'message');
			$row.find('.yair-message-row-content').attr('data-author', conversation.correspondent);
			if (yair.cfg.saved.contains(conversation.id)) {
				$row.find('.yair-save-toggle').addClass('yair-saved');
			}
			$row.find('.yair-save-toggle').on('click', yair.controller.action.toggleSave);
			$row.find('.icon-archive').on('click', yair.controller.action.delete);
			$row.find('.icon-restore').on('click', yair.controller.action.restore);
			$row.find('.icon-markRead').on('click', yair.controller.action.markRead);
			$row.find('.icon-markUnread').on('click', yair.controller.action.markUnread);
			if (unread) {
				$row.addClass('yair-unread');
			} else {
				$row.addClass('yair-read');
			}
			if (modmail) $row.addClass('yair-modmail');
			$row.data('conversation', conversation);
			var correspondentHref = (correspondent && correspondent.charAt(0) === "#") ?
				'https://www.reddit.com/r/' + encodeURIComponent(correspondent.substring(1)) :
				'https://www.reddit.com/user/' + encodeURIComponent(correspondent || '');
			var $author = $('<a class="author">').attr('href', correspondentHref).text(correspondent || '[unknown]');
			$row.find('.yair-correspondent').empty().append($author);
			yair.view.highlight($author, 'people');
			var count = conversation.messages.length;
			if (count > 1) {
				$('<span class="yair-message-count">').text(count).attr('title', count + ' messages in this conversation').appendTo($row.find('.yair-correspondent'));
			}
			yair.view.highlight($row.find('.yair-subject').text(subject), 'subject');
			// While searching, show the newest message that matched rather than the latest one
			var result = yair.model.cache.searchResults && yair.model.cache.searchResults.get(conversation);
			var $text = $row.find('.yair-text');
			if (result && result.matched && result.matched.length) {
				var hit = result.matched[0];
				var words = yair.search.terms(yair._get.searchObj, 'message');
				$text.empty();
				$('<span class="dlo-snippet-author">').text((hit.author === getUsername() ? 'You' : hit.author) + ': ').appendTo($text);
				$('<span>').text(yair.search.excerpt(decodeBasicEntities(hit.body || ''), words)).appendTo($text);
				yair.view.highlight($text, 'message');
				if (result.matched.length > 1) {
					$('<span class="dlo-match-count">').text(result.matched.length + ' matching messages').appendTo($row.find('.yair-subject'));
				}
			}
			else {
				$text.text(message);
				yair.view.highlight($text, 'message');
			}
			$row.find('.yair-datetime').text(dateString(datetime)).attr('title', yairTime.full(datetime));
			$row.attr('tabindex', '-1');
			var $checkbox = $row.find('input');
			$checkbox.on('change', function () {
				$row.toggleClass('yair-row-checked');
			});
			$row.on('click', yair.controller.showMessageClick);
			$row.find('.yair-message-row-control').on('click', function (e) {
				e.stopPropagation();
			});
			$row.find('.yair-correspondent').on('click', function (e) {
				e.stopPropagation();
			});
			$row.find('.yair-message-buttons').on('click', function (e) {
				e.stopPropagation();
			});
		}
		, updateBodyClass: function () {
			if (['inbox', 'saved', 'archived', 'conversation', 'modmail', 'modsaved', 'modarchived'].indexOf(yair.show) < 0) return;
			yair.$e.body.removeClass('yair-show-inbox yair-show-saved yair-show-archived yair-show-conversation yair-show-modmail yair-show-modsaved yair-show-modarchived');
			yair.$e.body.addClass('yair-show-' + yair.show);
		}
		, addConversationsToInbox: function (conversations) {
			var copy = conversations.slice();
			var conversationsAdded = 0;
			for (var i = 0; i < copy.length; i++) {
				var conversation = copy[i];
				// Group heading whenever the group changes: the year when sorted by
				// date, the thread length when sorted by size, the initial for A-Z
				var group = yair.model.groupFor(conversation);
				if (group && group.key !== yair.model.cache.lastGroup) {
					// Skip "this year" as the very first heading of a date-sorted list
					var skip = yair.model.cache.lastGroup === null && group.isCurrentYear;
					if (!skip) {
						$('<div class="yair-year-divider">').toggleClass('yair-group-text', !group.numeric).text(group.label).appendTo(yair.$e.mainPanel);
					}
					yair.model.cache.lastGroup = group.key;
				}
				// Add message to inbox
				yair.view.addMessageInInbox(conversation);
				// If the maximum number of conversations has been added
				if (++conversationsAdded > yair.cfg.data.maxInitialMessagesShown) {
					// Add load more content element
					yair.view.addLoadMoreElement(yair.templates['load_more_messages'], yair.$e.mainPanel, yair.view.addConversationsToInbox, copy.splice(i + 1));
					break;
				}
			}
		}
		, addLoadMoreElement: function (html, $container, callback, items) {
			var $element = $(html).appendTo($container);
			var scrollCallback = function () {
				if (!isElementInViewport($element)) return;
				$(window).off('scroll', scrollCallback);
				$element.remove();
				callback(items);
			};
			$(window).on('scroll', scrollCallback);
			scrollCallback();
		}
		// Sort and filter bar above the list. Built once; the year list is
		// refreshed from whichever folder is showing.
		, initListToolbar: function () {
			var $bar = $('.yair-list-toolbar');
			var opts = yair.model.listOptions;
			$bar.find('#YAIRSort').val(opts.sort).on('change', function () {
				opts.sort = this.value;
				yair.cfg.set('listSort', opts.sort);
				yair.view.rerenderList();
			});
			var numberInput = function (selector, key) {
				$bar.find(selector).on('input', function () {
					var n = parseInt(this.value, 10);
					opts[key] = n > 0 ? n : null;
					yair.view.rerenderListSoon();
				});
			};
			numberInput('#YAIRMinMessages', 'min');
			numberInput('#YAIRMaxMessages', 'max');
			$bar.find('#YAIRYear').on('change', function () {
				opts.year = this.value ? parseInt(this.value, 10) : null;
				yair.view.rerenderList();
			});
			$bar.find('#YAIRLastFrom').on('change', function () {
				opts.lastFrom = this.value || null;
				yair.view.rerenderList();
			});
			$bar.find('.yair-length-preset').on('click', function () {
				var $b = $(this);
				opts.min = $b.data('min') || null;
				opts.max = $b.data('max') || null;
				yair.view.syncListToolbar();
				yair.view.rerenderList();
			});
			yair.view.syncListToolbar();
		}
		, syncListToolbar: function () {
			var $bar = $('.yair-list-toolbar');
			var opts = yair.model.listOptions;
			$bar.find('#YAIRSort').val(opts.sort);
			$bar.find('#YAIRMinMessages').val(opts.min || '');
			$bar.find('#YAIRMaxMessages').val(opts.max || '');
			$bar.find('#YAIRYear').val(opts.year ? String(opts.year) : '');
			$bar.find('#YAIRLastFrom').val(opts.lastFrom || '');
			$bar.find('.yair-length-preset').each(function () {
				var $b = $(this);
				var on = (($b.data('min') || null) === opts.min) && (($b.data('max') || null) === opts.max);
				$b.toggleClass('yair-active', on).attr('aria-pressed', on ? 'true' : 'false');
			});
			$bar.toggleClass('yair-filters-active', yair.model.listFiltersActive());
		}
		, updateListToolbar: function (folderConversations) {
			var years = {};
			folderConversations.forEach(function (c) {
				if (c.last_update) years[new Date(c.last_update * 1000).getFullYear()] = true;
			});
			var $year = $('#YAIRYear');
			var current = $year.val();
			$year.find('option:not([value=""])').remove();
			Object.keys(years).sort().reverse().forEach(function (y) {
				$('<option>').attr('value', y).text(y).appendTo($year);
			});
			// Keep a chosen year even if this folder has none, so the filter stays visible
			if (current && !years[current]) $('<option>').attr('value', current).text(current).appendTo($year);
			$year.val(current);
		}
		, rerenderList: function () {
			yair.view.syncListToolbar();
			if (yair.show === 'conversation' || !yair.model.cache.conversations) return;
			yair.view.showInbox(yair.model.cache.conversations, false);
		}
		, rerenderListSoon: (function () {
			var timer = null;
			return function () {
				clearTimeout(timer);
				timer = setTimeout(yair.view.rerenderList, 250);
			};
		})()
		, bindActionButtons: function(){
            $('#YAIRBulkDelete').on('click', yair.controller.action.bulkDelete);
            $('#YAIRBulkRestore').on('click', yair.controller.action.bulkRestore);
            $('#YAIRBulkMarkUnread').on('click', yair.controller.action.bulkMarkUnread);
            $('#YAIRBulkMarkRead').on('click', yair.controller.action.bulkMarkRead);
            $('#YAIRShowConfig').on('click', yair.view.showConfig);
			$(document).on('change', '.styled-checkbox', yair.view.showBulkOptions);
			$('#select-all').on('change', yair.view.selectAll);
        }
		, showBulkOptions: function () {
			if($('.yair-main-panel .styled-checkbox').is(":checked")) {
				$(".yair-sidebar-options").removeClass("yair-hide");
			} else {
				$(".yair-sidebar-options").addClass("yair-hide");
				$('#select-all').prop("checked", false);
			}
		}
		, selectAll: function () {
			var checkedStatus = this.checked;
			$('.styled-checkbox').prop('checked', checkedStatus);
		}
	});
})(jQuery);
