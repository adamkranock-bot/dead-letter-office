// Model: list sorting, filtering and grouping, folder and search filters, read state, and the page cache. dbhelper.js adds indexing and storage.
(function ($) {
	var LENGTH_GROUPS = [
		[25, Infinity, '25 or more messages']
		, [10, 24, '10 to 24 messages']
		, [5, 9, '5 to 9 messages']
		, [2, 4, '2 to 4 messages']
		, [1, 1, 'Single messages']
	];
	Object.assign(yair.model, {
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
	});
})(jQuery);
