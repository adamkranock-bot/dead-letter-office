// Conversation view: messages, in-conversation search, and the read-only notice.
(function ($) {
	Object.assign(dlo.view, {
		showConversation: function (conversation) {
			// Remove previous contents of main panel
			dlo.$e.mainPanel.empty();
			var templateFile = dlo.cfg.data.conversationNewToOld ? dlo.templates.conversation_reverse : dlo.templates.conversation;
			var $conversation = $(templateFile).appendTo(dlo.$e.mainPanel);
			$conversation.data('conversation', conversation);
			var $messageArea = $conversation.find('.dlo-private-messages');
			var $saveToggle = $conversation.find('.dlo-save-toggle');
			$conversation.find('#collapseToggle').on('click', function () {
				var $toggle = $(this);
				var expand = $toggle.prop("title") === "Expand all";
				$messageArea.find('.dlo-private-message').toggleClass('dlo-collapsed', !expand);
				$toggle.toggleClass('dlo-all-expanded', expand).prop("title", expand ? "Collapse all" : "Expand all");
			});
			$conversation.find('#DLOExportConversation').on('click', dlo.controller.exportConversation);
			$conversation.find('.dlo-conversation-title').text(conversation.subject);
			$saveToggle.on('click', dlo.controller.action.toggleSave);
			if (dlo.cfg.saved.contains(conversation.id)) {
				$saveToggle.addClass('dlo-saved');
			}
			var messages = conversation.messages.slice();
			if (dlo.cfg.data.conversationNewToOld) { messages.reverse(); }
			var numMessages = messages.length;
			for (var i = 1; i <= numMessages; i++) {
				(function (pm) {
					var $pm = $(replaceAll(dlo.templates.private_message, '{author}', escapeHtml(pm.author)));
					// Every body goes through the same sanitiser, whichever way it was indexed
					$pm.find('.dlo-pm-body').html(dlo.helper.sanitizeHtml(pm.body_html));
					$pm.find('.dlo-pm-body-short').text(pm.body);
					$pm.find('.dlo-message-date-string').text(longDateString(pm.created_utc)).attr('data-timestamp', pm.created_utc);
					$pm.find('.dlo-message-date-string').attr("title", dloTime.full(pm.created_utc));
					$pm.find('.dlo-pm-header').on('click', function () {
						$pm.toggleClass('dlo-collapsed');
					});
					$pm.find('.dlo-title-text h4').on('click', function (e) {
						e.stopPropagation();
						var name = this.innerText;
						if (name.charAt(0) === '#') {
							window.open('/r/' + encodeURIComponent(name.substring(1)), '_blank');
						}
						else if (name !== '[unknown]') {
							window.open('/user/' + encodeURIComponent(name), '_blank');
						}
					});
					if (pm.author === getUsername()) $pm.addClass('dlo-from-me');
					$pm.attr('data-name', pm.name);
					$pm.appendTo($messageArea);
					if (pm['new']) return;
					if (dlo.cfg.data.conversationNewToOld && i === 1) return;
					if (!dlo.cfg.data.conversationNewToOld && i === numMessages) return;
					$pm.addClass('dlo-collapsed');
				})(messages[numMessages - i]);
			}
			if (!dlo.cfg.data.conversationNewToOld) dlo.view.scrollToUnread();
			dlo.view.addArchiveNotice($conversation);

			dlo.view.updateBodyClass();
			dlo.model.setConversationStatus(conversation, true);
			dlo.model.markReadOnReddit(conversation);

			// Only bind the buttons in the conversation header; the sidebar uses the same icon classes
			var $headerButtons = $conversation.find('.conversation-header-right');
			if (dlo.cfg.deleted.contains(conversation.id)){
				$headerButtons.find('.icon-archive').hide();
			} else {
				$headerButtons.find('.icon-restore').hide();
			}
			$headerButtons.find('.icon-archive').on('click', dlo.controller.action.bulkDelete);
			$headerButtons.find('.icon-restore').on('click', dlo.controller.action.bulkRestore);
			$headerButtons.find('.icon-markUnread').on('click', dlo.controller.action.bulkMarkUnread);
			
			if (dlo.cfg.data.showModmail) {
				$(".dlo-modmail").removeClass("dlo-hide");
			}
			dlo.view.applySearchToConversation($conversation, conversation);
		}
		, scrollToUnread: function () {
			var $firstUnread = $('.dlo-private-message:not(.dlo-collapsed)').first();
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
			var q = dlo.model.cache.activeSearch;
			if (!q) return;
			var result = dlo.search.match(conversation, q, {
				saved: function () { return true; }
				, archived: function () { return true; }
			});
			var matchedNames = {};
			(result.matched || []).forEach(function (m) { matchedNames[m.name] = true; });
			var words = dlo.search.terms(q, 'message');
			var people = dlo.search.terms(q, 'people');
			$conversation.find('.dlo-private-message').each(function () {
				var $pm = $(this);
				if (!matchedNames[$pm.attr('data-name')]) return;
				$pm.removeClass('dlo-collapsed').addClass('dlo-search-hit');
				dlo.search.mark($pm.find('.dlo-pm-body')[0], words);
				dlo.search.mark($pm.find('.dlo-title-text h4')[0], people);
			});
			dlo.search.mark($conversation.find('.dlo-conversation-title')[0], dlo.search.terms(q, 'subject'));
			var $marks = $conversation.find('.dlo-pm-body mark');
			var $hits = $conversation.find('.dlo-search-hit');
			var targets = $marks.length ? $marks : $hits;
			if (!targets.length) return;
			var unit = $marks.length ? 'match' : 'message';
			var $bar = $('<div class="dlo-findbar" role="status">');
			var $label = $('<span class="dlo-findbar-label">').appendTo($bar);
			var $prev = $('<button type="button" class="dlo-findbar-btn" aria-label="Previous match" title="Previous (Shift+N)">').text('\u2039').appendTo($bar);
			var $next = $('<button type="button" class="dlo-findbar-btn" aria-label="Next match" title="Next (N)">').text('\u203a').appendTo($bar);
			$('<button type="button" class="dlo-findbar-clear">').text('Clear').on('click', dlo.view.clearConversationSearch).appendTo($bar);
			var index = -1;
			var go = function (step) {
				index = (index + step + targets.length) % targets.length;
				targets.removeClass('dlo-current');
				var el = targets.eq(index).addClass('dlo-current')[0];
				var $pm = $(el).closest('.dlo-private-message').removeClass('dlo-collapsed');
				el.scrollIntoView({ block: 'center' });
				var noun = unit === 'match' ? (targets.length === 1 ? 'match' : 'matches') : (targets.length === 1 ? 'message' : 'messages');
				$label.text((index + 1) + ' of ' + targets.length + ' ' + noun);
			};
			$prev.on('click', function () { go(-1); });
			$next.on('click', function () { go(1); });
			$conversation.find('.dlo-conversation-header').append($bar);
			dlo.model.cache.findStep = go;
			go(1);
		}
		, clearConversationSearch: function () {
			dlo.model.cache.activeSearch = null;
			dlo.model.cache.findStep = null;
			var $c = $('.dlo-conversation');
			$c.find('.dlo-findbar').remove();
			$c.find('mark').each(function () { $(this).replaceWith(this.textContent); });
			$c.find('.dlo-search-hit').removeClass('dlo-search-hit');
		}
		// Reddit keeps these messages as a read-only archive; point to Chat for anything new
		, addArchiveNotice: function ($conversation) {
			var $notice = $('<div class="dlo-archive-notice">');
			$('<p>').text('Reddit keeps old private messages as a read-only archive. To keep talking, message them in Reddit Chat.').appendTo($notice);
			var $actions = $('<div class="dlo-archive-notice-actions">').appendTo($notice);
			$('<a class="dlo-button dlo-button-plain" target="_blank" rel="noopener">').attr('href', 'https://chat.reddit.com/').text('Open Reddit Chat').appendTo($actions);
			$conversation.find('.dlo-privatemessage-container').append($notice);
		}
	});
})(jQuery);
