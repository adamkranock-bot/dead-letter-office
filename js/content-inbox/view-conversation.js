// Conversation view: messages, in-conversation search, and the read-only notice.
(function ($) {
	Object.assign(yair.view, {
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
		, scrollToUnread: function () {
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
		// Reddit keeps these messages as a read-only archive; point to Chat for anything new
		, addArchiveNotice: function ($conversation) {
			var $notice = $('<div class="yair-archive-notice">');
			$('<p>').text('Reddit keeps old private messages as a read-only archive. To keep talking, message them in Reddit Chat.').appendTo($notice);
			var $actions = $('<div class="yair-archive-notice-actions">').appendTo($notice);
			$('<a class="yair-button yair-button-plain" target="_blank" rel="noopener">').attr('href', 'https://chat.reddit.com/').text('Open Reddit Chat').appendTo($actions);
			$conversation.find('.yair-privatemessage-container').append($notice);
		}
	});
})(jQuery);
