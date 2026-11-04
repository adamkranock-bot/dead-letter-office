(function ($) {
	yair.templates.add({
		inbox_layout: chrome.runtime.getURL('template/inbox_layout.html'),
		inbox_message_row: chrome.runtime.getURL('template/inbox_message_row.html'),
		conversation: chrome.runtime.getURL('template/conversation.html'),
		conversation_reverse: chrome.runtime.getURL('template/conversation_reverse.html'),
		private_message: chrome.runtime.getURL('template/private_message.html'),
		load_more_messages: chrome.runtime.getURL('template/load_more_messages.html'),
		config: chrome.runtime.getURL('template/config.html')
	});
	yair.init.funcs.push(yair.functions.DOMReady);
	yair.init.funcs.push(yair.functions.preloadTemplatesReady);
	yair.view = {
		scrollToUnread: function () {
			var $firstUnread = $('.yair-private-message:not(.yair-collapsed)').first();
			if (!$firstUnread.length) { return; }
			var rect = $firstUnread[0].getClientRects();
			if (!rect.length) { return; }
			var top = rect[0].top + window.scrollY;
			var scrollTo = top - 190;
			if (scrollTo <= 100) { return; }
			$('html, body').animate({
				scrollTop: scrollTo
			}, 750);
		},
		showConversation: function (conversation) {
			// Remove previous contents of main panel
			yair.$e.mainPanel.empty();
			var templateFile = yair.cfg.data.conversationNewToOld ? yair.templates.conversation_reverse : yair.templates.conversation;
			var $conversation = $(templateFile).appendTo(yair.$e.mainPanel);
			$conversation.data('conversation', conversation);
			var $messageArea = $conversation.find('.yair-private-messages');
			var $saveToggle = $conversation.find('.yair-save-toggle');
			$conversation.find('#collapseToggle').on('click', function () {
				var $toggle = $(this);
				var expand = $toggle.prop("title") === "Expand all";
				$messageArea.find('.yair-private-message').toggleClass('yair-collapsed', !expand);
				$toggle.toggleClass('yair-all-expanded', expand).prop("title", expand ? "Collapse all" : "Expand all");
			});
			$conversation.find('#YairExportConversation').on('click', yair.controller.exportConversation);
			$conversation.find('.yair-conversation-title').text(conversation.subject);
			$saveToggle.on('click', yair.controller.action.toggleSave);
			if (yair.cfg.saved.contains(conversation.id)) {
				$saveToggle.addClass('yair-saved');
			}
			var messages = conversation.messages.slice();
			if (yair.cfg.data.conversationNewToOld) { messages.reverse(); }
			var numMessages = messages.length;
			for (var i = 1; i <= numMessages; i++) {
				(function (pm) {
					var $pm = $(replaceAll(yair.templates.private_message, '{author}', escapeHtml(pm.author)));
					// Every body goes through the same sanitiser, whichever way it was indexed
					$pm.find('.yair-pm-body').html(yair.helper.sanitizeHtml(pm.body_html));
					$pm.find('.yair-pm-body-short').text(pm.body);
					$pm.find('.yair-message-date-string').text(longDateString(pm.created_utc)).attr('data-timestamp', pm.created_utc);
					$pm.find('.yair-message-date-string').attr("title", yairTime.full(pm.created_utc));
					$pm.find('.yair-pm-header').on('click', function () {
						$pm.toggleClass('yair-collapsed');
					});
					$pm.find('.yair-title-text h4').on('click', function (e) {
						e.stopPropagation();
						var name = this.innerText;
						if (name.charAt(0) === '#') {
							window.open('/r/' + encodeURIComponent(name.substring(1)), '_blank');
						}
						else if (name !== '[unknown]') {
							window.open('/user/' + encodeURIComponent(name), '_blank');
						}
					});
					if (pm.author === getUsername()) $pm.addClass('yair-from-me');
					$pm.attr('data-name', pm.name);
					$pm.appendTo($messageArea);
					if (pm['new']) return;
					if (yair.cfg.data.conversationNewToOld && i === 1) return;
					if (!yair.cfg.data.conversationNewToOld && i === numMessages) return;
					$pm.addClass('yair-collapsed');
				})(messages[numMessages - i]);
			}
			if (!yair.cfg.data.conversationNewToOld) yair.view.scrollToUnread();
			yair.view.addArchiveNotice($conversation);

			yair.view.updateBodyClass();
			yair.model.setConversationStatus(conversation, true);
			yair.model.markReadOnReddit(conversation);

			// Only bind the buttons in the conversation header; the sidebar uses the same icon classes
			var $headerButtons = $conversation.find('.conversation-header-right');
			if (yair.cfg.deleted.contains(conversation.id)){
				$headerButtons.find('.icon-archive').hide();
			} else {
				$headerButtons.find('.icon-restore').hide();
			}
			$headerButtons.find('.icon-archive').on('click', yair.controller.action.bulkDelete);
			$headerButtons.find('.icon-restore').on('click', yair.controller.action.bulkRestore);
			$headerButtons.find('.icon-markUnread').on('click', yair.controller.action.bulkMarkUnread);
			
			if (yair.cfg.data.showModmail) {
				$(".yair-modmail").removeClass("yair-hide");
			}
			yair.view.applySearchToConversation($conversation, conversation);
		}
		// Opened from search results: open the matching messages, highlight the
		// words, and add a find bar to step through them (n / N)
		, applySearchToConversation: function ($conversation, conversation) {
			var q = yair.model.cache.activeSearch;
			if (!q) return;
			var result = yair.search.match(conversation, q, {
				saved: function () { return true; }
				, archived: function () { return true; }
			});
			var matchedNames = {};
			(result.matched || []).forEach(function (m) { matchedNames[m.name] = true; });
			var words = yair.search.terms(q, 'message');
			var people = yair.search.terms(q, 'people');
			$conversation.find('.yair-private-message').each(function () {
				var $pm = $(this);
				if (!matchedNames[$pm.attr('data-name')]) return;
				$pm.removeClass('yair-collapsed').addClass('dlo-search-hit');
				yair.search.mark($pm.find('.yair-pm-body')[0], words);
				yair.search.mark($pm.find('.yair-title-text h4')[0], people);
			});
			yair.search.mark($conversation.find('.yair-conversation-title')[0], yair.search.terms(q, 'subject'));
			var $marks = $conversation.find('.yair-pm-body mark');
			var $hits = $conversation.find('.dlo-search-hit');
			var targets = $marks.length ? $marks : $hits;
			if (!targets.length) return;
			var unit = $marks.length ? 'match' : 'message';
			var $bar = $('<div class="dlo-findbar" role="status">');
			var $label = $('<span class="dlo-findbar-label">').appendTo($bar);
			var $prev = $('<button type="button" class="dlo-findbar-btn" aria-label="Previous match" title="Previous (Shift+N)">').text('\u2039').appendTo($bar);
			var $next = $('<button type="button" class="dlo-findbar-btn" aria-label="Next match" title="Next (N)">').text('\u203a').appendTo($bar);
			$('<button type="button" class="dlo-findbar-clear">').text('Clear').on('click', yair.view.clearConversationSearch).appendTo($bar);
			var index = -1;
			var go = function (step) {
				index = (index + step + targets.length) % targets.length;
				targets.removeClass('dlo-current');
				var el = targets.eq(index).addClass('dlo-current')[0];
				var $pm = $(el).closest('.yair-private-message').removeClass('yair-collapsed');
				el.scrollIntoView({ block: 'center' });
				var noun = unit === 'match' ? (targets.length === 1 ? 'match' : 'matches') : (targets.length === 1 ? 'message' : 'messages');
				$label.text((index + 1) + ' of ' + targets.length + ' ' + noun);
			};
			$prev.on('click', function () { go(-1); });
			$next.on('click', function () { go(1); });
			$conversation.find('.yair-conversation-header').append($bar);
			yair.model.cache.findStep = go;
			go(1);
		}
		, clearConversationSearch: function () {
			yair.model.cache.activeSearch = null;
			yair.model.cache.findStep = null;
			var $c = $('.yair-conversation');
			$c.find('.dlo-findbar').remove();
			$c.find('mark').each(function () { $(this).replaceWith(this.textContent); });
			$c.find('.dlo-search-hit').removeClass('dlo-search-hit');
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
		, setFavicon: function () {
			var icon = '16.png';
			$('head link[rel="shortcut icon"]').remove();
			var link = document.createElement('link');
			link.type = 'image/png';
			link.rel = 'shortcut icon';
			link.href = chrome.runtime.getURL('images/icons/' + icon);
			document.querySelector('head').appendChild(link);
		}
		, update: function () {
			// Init search from URL
			yair.view.hideOverlay();
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
		// nightMode: false (light), true (dark), or 'auto' (follow the system setting)
		, applyTheme: function () {
			var mode = yair.cfg.data.nightMode;
			var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
			var dark = mode === 'auto' ? !!(media && media.matches) : !!mode;
			yair.$e.body.toggleClass('yair-nightmode', dark);
			if (media && !yair.model.cache.themeListener) {
				yair.model.cache.themeListener = true;
				var onChange = function () {
					if (yair.cfg.data.nightMode === 'auto') yair.view.applyTheme();
				};
				if (media.addEventListener) media.addEventListener('change', onChange);
				else if (media.addListener) media.addListener(onChange);
			}
		}
		// j/k move through conversations, Enter/o opens, Esc/u goes back, / searches
		, bindKeyboard: function () {
			$(document).on('keydown.yairKeys', function (e) {
				if (e.ctrlKey || e.metaKey || e.altKey) return;
				var target = e.target;
				if (target && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable)) return;
				if (yair.$e.overlay.hasClass('show')) return;
				if (yair.show === 'conversation') {
					if ((e.key === 'n' || e.key === 'N') && yair.model.cache.findStep) {
						e.preventDefault();
						yair.model.cache.findStep(e.key === 'N' ? -1 : 1);
						return;
					}
					if (e.key === 'Escape' || e.key === 'u') {
						e.preventDefault();
						yair.controller.backToList();
					}
					return;
				}
				var $rows = yair.$e.mainPanel.find('.yair-message-row');
				if (!$rows.length) return;
				var index = yair.model.cache.focusIndex;
				if (e.key === 'j' || e.key === 'k') {
					e.preventDefault();
					index = Math.max(0, Math.min($rows.length - 1, index + (e.key === 'j' ? 1 : -1)));
					yair.model.cache.focusIndex = index;
					$rows.removeClass('yair-row-focused');
					var row = $rows.eq(index).addClass('yair-row-focused')[0];
					row.focus({ preventScroll: true });
					row.scrollIntoView({ block: 'nearest' });
				}
				else if ((e.key === 'Enter' || e.key === 'o') && index >= 0) {
					e.preventDefault();
					$rows.eq(index).trigger('click');
				}
				else if (e.key === 'x' && index >= 0) {
					e.preventDefault();
					$rows.eq(index).find('input[type="checkbox"]').trigger('click');
				}
				else if (e.key === '/') {
					e.preventDefault();
					yair.$e.search.trigger('focus');
				}
			});
		}
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
		, showConfig: function () {
			var $config = $(yair.templates.config);
			$config.on('click', stopEvent);
			// TABS
			var contentTabs = {};
			var $contentTabs = $config.find('.yair-config-content-panel .yair-config-content');
			$contentTabs.each(function () {
				var $content = $(this);
				var name = $content.data('tab-content');
				contentTabs[name] = $content;
			});
			var $tabs = $config.find('.yair-config-tabs .yair-config-tab');
			$tabs.on('click', function () {
				var $tab = $(this);
				var name = $tab.data('tab');
				$tabs.removeClass('yair-active-tab');
				$tab.addClass('yair-active-tab');
				$contentTabs.removeClass('yair-active-tab');
				contentTabs[name].addClass('yair-active-tab');
			});
			// Buttons
			$config.find('#YAIRResetInboxToggle').on('click', function () {
				$config.find('#YAIRConfirmReset').removeClass('yair-hide');
			});
			$config.find('#YAIRResetInbox').on('click', function () {
				yair.$e.overlay.empty().off();
				yair.controller.resetInbox();
			});
			$config.find('#YAIRReindexMessages').on('click', function () {
				yair.$e.overlay.empty().off();
				yair.controller.reindexMessages();
			});
			$config.find('.yair-export-all').on('click', function () {
				yair.controller.exportAll($(this).data('format'));
			});
			$config.find('#YAIRCancelResetInbox').on('click', function () {
				$config.find('#YAIRConfirmReset').addClass('yair-hide');
			});
			// Set checkbox-states
			var $showModMail = $config.find('#YAIRShowModMail');
			$showModMail.prop('checked', yair.cfg.data.showModmail);
			var $compactMode = $config.find('#YAIRCompactMode');
			$compactMode.prop('checked', yair.cfg.data.compactMode);

			var $nightMode = $config.find('#YairNightMode');
			$nightMode.val(yair.cfg.data.nightMode === 'auto' ? 'auto' : (yair.cfg.data.nightMode ? 'on' : 'off'));
			
			var $showNewFirst = $config.find('#YAIRNewFirst');
			$showNewFirst.prop('checked', yair.cfg.data.conversationNewToOld);

			//set dropdown state
			var $inboxRefreshInterval = $config.find("#YAIRRefreshInterval");
			var currentInterval = String(yair.cfg.data.inboxRefreshInterval);
			if (!$inboxRefreshInterval.find('option[value="' + currentInterval + '"]').length) {
				// A value from an older version that's no longer in the list
				var minutes = Math.round(+currentInterval / 60000);
				$('<option>').attr('value', currentInterval).text(minutes <= 1 ? 'Every minute' : 'Every ' + minutes + ' minutes').appendTo($inboxRefreshInterval);
			}
			$inboxRefreshInterval.val(currentInterval);
			
			// Save settings
			$config.find('.yair-config-footer .yair-save-button').on('click', function () {
				var showModmail = $showModMail.prop('checked');
				var compactMode = $compactMode.prop('checked');
				var nightModeChoice = $nightMode.val();
				var nightMode = nightModeChoice === 'auto' ? 'auto' : nightModeChoice === 'on';
				var showNewFirst = $showNewFirst.prop('checked');
				var inboxRefreshInterval = $inboxRefreshInterval.val();
				// Same element initLayout uses, so the setting can be turned off again
				yair.$e.body.toggleClass('yair-compact-mode', compactMode);
				yair.cfg.set('showModmail', showModmail);
				yair.cfg.set('compactMode', compactMode);
				yair.cfg.set('nightMode', nightMode);
				yair.view.applyTheme();
				yair.cfg.set('conversationNewToOld', showNewFirst);
				yair.cfg.set('inboxRefreshInterval', parseInt(inboxRefreshInterval, 10));
				if (yair.show === "conversation") {
					yair.view.showNotification("Refresh page for this to take effect");
				}
				else {
					yair.view.showInbox(yair.model.cache.conversations, false);
				}
				yair.$e.body.removeClass('yair-modal-open');
				yair.view.hideOverlay();
			});
			yair.$e.body.addClass('yair-modal-open');
			yair.$e.overlay.empty().append($config);
			yair.view.showOverlay(true, function () {
				yair.$e.body.removeClass('yair-modal-open');
			});
			
			if ( !$("#new_modmail").length && !$("#modmail").length ) {
				$("#ModMail-config").css("display","none");
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
		// Reddit keeps these messages as a read-only archive; point to Chat for anything new
		, addArchiveNotice: function ($conversation) {
			var $notice = $('<div class="yair-archive-notice">');
			$('<p>').text('Reddit keeps old private messages as a read-only archive. To keep talking, message them in Reddit Chat.').appendTo($notice);
			var $actions = $('<div class="yair-archive-notice-actions">').appendTo($notice);
			$('<a class="yair-button yair-button-plain" target="_blank" rel="noopener">').attr('href', 'https://chat.reddit.com/').text('Open Reddit Chat').appendTo($actions);
			$conversation.find('.yair-privatemessage-container').append($notice);
		}
	};
	yair.controller = {
		resetInbox: function () {
			yair.view.showLoading('Clearing inbox');
			yair.proxy(['yair', 'db', 'clearObjectStore'], [db_tables.privateMessages.name], function () {
				yair.cfg.set('pmInboxInitialized', false);
				yair.cfg.set('archiveThreads', {});
				yair.controller.reloadInbox();
			});
		}
		, conversationToText: function (conversation) {
			var data = '# ' + conversation.subject + "\r\n\r\n";
			var messages = conversation.messages.slice().sort(function (a, b) {
				return a.created_utc - b.created_utc;
			});
			for (var j = 0; j < messages.length; j++) {
				if (j > 0) { data += "\r\n---\r\n"; }
				var message = messages[j];
				data += '## From: ' + message.author + ' | To: ' + (message.dest || '') + ' | Date: ' + sysDateStr(message.created_utc * 1000) + ' ' + sysTimeStr(message.created_utc * 1000, ':') + "\r\n\r\n";
				data += String(message.body || '').replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n") + "\r\n";
			}
			return data;
		}
		, exportConversation: function () {
			var conversation = $('.yair-conversation').data('conversation');
			if (!conversation) { return; }
			var last = conversation.last_update || getTime() / 1000;
			var filename = safeFilename(conversation.subject) + '_' + sysDateStr(last * 1000) + '_' + sysTimeStr(last * 1000, '-') + '.txt';
			downloadText(filename, yair.controller.conversationToText(conversation));
		}
		// Download every stored conversation, as plain text or JSON
		, exportAll: function (format) {
			yair.view.showLoading('Preparing export');
			yair.model.getConversations(function (conversations) {
				conversations.sort(function (a, b) {
					return b.last_update - a.last_update;
				});
				var stamp = sysDateStr() + '_' + sysTimeStr(undefined, '-');
				var base = 'dead-letter-office_' + safeFilename(getUsername()) + '_' + stamp;
				if (format === 'json') {
					var payload = conversations.map(function (c) {
						return {
							id: c.id
							, subject: c.subject
							, correspondent: c.correspondent
							, modmail: c.modmail
							, saved: yair.cfg.saved.contains(c.id)
							, archived: yair.cfg.deleted.contains(c.id)
							, messages: c.messages.slice().sort(function (a, b) {
								return a.created_utc - b.created_utc;
							})
						};
					});
					downloadText(base + '.json', JSON.stringify({
						exported_utc: Math.floor(getTime() / 1000)
						, username: getUsername()
						, conversations: payload
					}, null, 2), 'application/json');
				}
				else {
					downloadText(base + '.txt', conversations.map(yair.controller.conversationToText).join("\r\n---\r\n---\r\n"));
				}
				yair.view.showNotification('Exported ' + conversations.length + ' conversations');
			});
		}
		, reindexMessages: function () {
			yair.view.showLoading('Reindexing inbox');
			yair.model.reindexPrivateMessages(function (added) {
				yair.view.update();
				yair.view.setFavicon();
				yair.view.showNotification('Reindex complete: ' + (added || 0) + ' new messages found', 2500);
			}, function (errorMessage) {
				yair.view.showNotification(errorMessage, -1);
				console.error("DB has NOT been updated", arguments);
			});
		}
		, showMessageClick: function () {
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
				yair.view.showNotification(errorMessage, -1);
				console.error("DB has NOT been updated", arguments);
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
	};
	var LENGTH_GROUPS = [
		[25, Infinity, '25 or more messages']
		, [10, 24, '10 to 24 messages']
		, [5, 9, '5 to 9 messages']
		, [2, 4, '2 to 4 messages']
		, [1, 1, 'Single messages']
	];
	yair.model = {
		// Sort and filter state for the list; sort is remembered between visits
		listOptions: {
			sort: 'newest'
			, min: null
			, max: null
			, year: null
			, lastFrom: null
		}
		, listFiltersActive: function () {
			var o = yair.model.listOptions;
			return !!(o.min || o.max || o.year || o.lastFrom);
		}
		, listFilter: function (conversations) {
			var o = yair.model.listOptions;
			var me = getUsername();
			for (var i = 0; i < conversations.length; i++) {
				var c = conversations[i];
				var n = c.messages.length;
				var year = c.last_update ? new Date(c.last_update * 1000).getFullYear() : null;
				var lastByMe = c.last_author === me;
				if ((o.min && n < o.min) ||
					(o.max && n > o.max) ||
					(o.year && year !== o.year) ||
					(o.lastFrom === 'me' && !lastByMe) ||
					(o.lastFrom === 'them' && lastByMe)) {
					conversations.splice(i--, 1);
				}
			}
		}
		, sortConversations: function (conversations) {
			var by = yair.model.listOptions.sort;
			var newestFirst = function (a, b) { return (b.last_update || 0) - (a.last_update || 0); };
			var name = function (c) { return String(c.correspondent || '').replace(/^#/, '').toLowerCase(); };
			var compare = {
				newest: newestFirst
				, oldest: function (a, b) { return (a.last_update || 0) - (b.last_update || 0); }
				, most: function (a, b) { return (b.messages.length - a.messages.length) || newestFirst(a, b); }
				, fewest: function (a, b) { return (a.messages.length - b.messages.length) || newestFirst(a, b); }
				, az: function (a, b) { return name(a).localeCompare(name(b)) || newestFirst(a, b); }
				, started: function (a, b) {
					var first = function (c) {
						return c.messages.reduce(function (m, x) { return Math.min(m, x.created_utc || Infinity); }, Infinity);
					};
					return first(b) - first(a);
				}
			}[by] || newestFirst;
			conversations.sort(compare);
		}
		, groupFor: function (c) {
			var by = yair.model.listOptions.sort;
			if (by === 'most' || by === 'fewest') {
				var n = c.messages.length;
				for (var i = 0; i < LENGTH_GROUPS.length; i++) {
					if (n >= LENGTH_GROUPS[i][0] && n <= LENGTH_GROUPS[i][1]) {
						return { key: 'len' + i, label: LENGTH_GROUPS[i][2], numeric: false };
					}
				}
				return null;
			}
			if (by === 'az') {
				var ch = String(c.correspondent || '?').charAt(0);
				if (ch === '#') return { key: '#', label: 'Subreddits', numeric: false };
				ch = ch.toUpperCase();
				if (!/[A-Z]/.test(ch)) ch = '0\u20139';
				return { key: ch, label: ch, numeric: true };
			}
			var ts = c.last_update;
			if (by === 'started') {
				ts = c.messages.reduce(function (m, x) { return Math.min(m, x.created_utc || Infinity); }, Infinity);
			}
			if (!ts || ts === Infinity) return null;
			var year = new Date(ts * 1000).getFullYear();
			return { key: 'y' + year, label: String(year), numeric: true, isCurrentYear: year === new Date().getFullYear() };
		}
		// Tell Reddit the received messages in this conversation have been read,
		// in batches rather than one request per message, then refresh the badge.
		, markReadOnReddit: function (conversation) {
			var me = getUsername();
			var names = conversation.messages.filter(function (m) {
				return m.author !== me && /^t4_/.test(m.name || '');
			}).map(function (m) {
				return m.name;
			});
			if (!names.length) return;
			var pending = 0;
			for (var i = 0; i < names.length; i += 25) {
				pending++;
				yair.request('redditPost', {
					endpoint: 'read_message'
					, form: {
						id: names.slice(i, i + 25).join(',')
						, uh: yair.model.uh
					}
				}, function () {
					if (--pending === 0) yair.request('updateNotifications');
				});
			}
		}
		, setConversationStatus: function (conversation, read) {
			var updated = [];
			for (var i = 0; i < conversation.messages.length; i++) {
				if (conversation.messages[i]['new'] === read) {
					conversation.messages[i]['new'] = !read;
					updated.push(conversation.messages[i]);
				}
			}
			if (updated.length > 0) {
				yair.proxy(['yair', 'db', 'updateAll'], [db_tables.privateMessages.name, updated]);
			}
		}
		, showModmailInInbox: function (filteredConversations) {
			if (yair.cfg.data.showModmail) {
				$(".yair-modmail").removeClass("yair-hide");
				if(['modmail', 'modsaved', 'modarchived'].indexOf(yair.show) >= 0) {
					yair.model.modmailFilter(filteredConversations, true);
				} else { yair.model.modmailFilter(filteredConversations, false); }
			} else { $(".yair-modmail").addClass("yair-hide"); }
		}
		, modmailFilter: function (conversations, modDirectory) {
			for (var i = 0; i < conversations.length; i++) {
				var conversation = conversations[i];
				if (modDirectory) { if (!conversation.modmail) { conversations.splice(i--, 1); }
				} else { if (conversation.modmail) { conversations.splice(i--, 1); } }
			}
		}
		, directoryFilter: function (conversations, directory) {
			if (typeof directory === "undefined") {
				directory = yair.show;
			}
			for (var i = 0; i < conversations.length; i++) {
				var conversation = conversations[i];
				var saved = yair.cfg.saved.contains(conversation.id);
				var archived = yair.cfg.deleted.contains(conversation.id);
				if (directory !== "archived" && directory !== "modarchived"  && archived  ||
					directory === "saved"       && !saved    ||
					directory === "archived"    && !archived ||
					directory === "modsaved"    && !saved    ||
					directory === "modarchived" && !archived
				   ) { conversations.splice(i--, 1); }
			}
		}
		, searchFilter: function (conversations) {
			var q = yair._get.searchObj;
			yair.model.cache.searchResults = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
			if (!q) return;
			var flags = {
				saved: function (id) { return yair.cfg.saved.contains(id); }
				, archived: function (id) { return yair.cfg.deleted.contains(id); }
			};
			for (var i = 0; i < conversations.length; i++) {
				var result = yair.search.match(conversations[i], q, flags);
				if (!result.ok) {
					conversations.splice(i--, 1);
				}
				else if (yair.model.cache.searchResults) {
					yair.model.cache.searchResults.set(conversations[i], result);
				}
			}
		}
		, cloneAndSortConversations: function (conversations, oldToNew) {
			if (typeof oldToNew === "undefined") {
				oldToNew = true;
			}
			var clone = JSON.parse(JSON.stringify(conversations));
			clone.sort(function (a, b) {
				if (a.last_update === b.last_update) return 0;
				return (a.last_update > b.last_update) ? 1 : -1;
			});
			for (var i = 0; i < clone.length; i++) {
				clone[i].messages.sort(function (a, b) {
					if (a.created_utc === b.created_utc) return 0;
					return (a.created_utc > b.created_utc) ? 1 : -1;
				});
			}
			return clone;
		}
		, getConversationContexts: function (conversations) {
			var contexts = [];
			for (var i = 0; i < conversations.length; i++) {
				var context = JSON.parse(JSON.stringify(conversations[i]));
				delete context.messages;
				contexts.push(context);
			}
			return contexts;
		}
		, removeConversationContexts: function (conversations) {
			var messages = [];
			for (var i = 0; i < conversations.length; i++) {
				var conversation = conversations[i];
				for (var j = 0; j < conversation.messages.length; j++) {
					messages.push(conversation.messages[j]);
				}
			}
			return messages;
		}
		, cache: {
			conversations: []
			, hideOverlay: false
		}
	};
	yair.init.start();
	yair.init.executeAfter(['DOMReady', 'preloadTemplatesReady'], function () {
		// The DOM is ready and templates have been preloaded
		// Don't do anything if it's a 503
		if (document.title.indexOf("Ow!") >= 0) return;
		if (!isLoggedIn()) return;
		// Parse the URL
		yair.controller.parseUrl();
		yair.functions.initConfig(function () {
			// Initialize default layout elements
			yair.view.setFavicon();
			yair.view.initLayout(); // To set the page title, we need our config
			yair.view.bindActionButtons();
			// The notifier polls with the interval of whichever user last opened the archive
			yair.cfg.set('inboxRefreshInterval', yair.cfg.data.inboxRefreshInterval);
			yair.view.showLoading();
			yair.proxy(['yair', 'db', 'init'], [], yair.controller.reloadInbox);
		});
	});
})(jQuery);