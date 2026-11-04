(function (undefined) {
	yair.helper.fixPrivateMessage = function (obj) {
		var msg = getObjAttributes(obj, db_tables.privateMessages.columns);
		if (!msg.author && obj.subreddit) msg.author = '#' + obj.subreddit;
		if (!msg.author) msg.author = "[unknown]";
		if (!msg.first_message_name) msg.first_message_name = msg.name;
		if (isMessageHTMLEncoded(msg)) {
			msg.subject = htmlDecode(msg.subject);
			msg.body_html = htmlDecode(msg.body_html);
			msg.body = htmlDecode(msg.body);
		}
		if (msg.created) delete msg.created;
		return msg;
	};

	function getObjAttributes(obj, attributes) {
		var r = {};
		for (var i = 0; i < attributes.length; i++) {
			var attr = attributes[i];
			if (obj[attr] !== undefined) {
				r[attr] = obj[attr];
			}
		}
		return r;
	}
	yair.model.updateDb = function (success, error) {
		yair.proxy(['yair', 'db', 'countObjectsInStore'], [db_tables.privateMessages.name], function (num) {
			if (yair.cfg.data.pmInboxInitialized && num > 10) {
				// Only fetch until we reach messages we already have
				crawlAllSources(true, success, error);
			}
			else {
				// First run (or after a reset): index everything Reddit will give us
				crawlAllSources(false, function (added) {
					yair.cfg.set('pmInboxInitialized', true);
					success(added);
				}, error);
			}
		});
	};
	yair.model.reindexPrivateMessages = function (success, error) {
		crawlAllSources(false, success, error);
	};

	// Reddit moved private message history out of messages.json and into a
	// read-only archive page on new Reddit (www.reddit.com/message/messages/).
	// Read both: the JSON listing still carries anything Reddit delivers there,
	// and the archive carries the history. Messages are keyed by id, so
	// overlap between the two is ignored.
	function crawlAllSources(stopWhenNothingNew, done, fail) {
		crawlPrivateMessages(stopWhenNothingNew, function (fromJson) {
			crawlArchive(stopWhenNothingNew, function (fromArchive) {
				done((fromJson || 0) + (fromArchive || 0));
			}, function (message) {
				// The JSON part worked; report the archive problem without losing it
				console.error("DLO archive indexing failed:", message);
				if (typeof fail === "function") fail(message);
			});
		}, fail);
	}

	function crawlArchive(stopWhenNothingNew, done, fail) {
		var pageNum = 1;
		var totalAdded = 0;
		var seen = {};
		// Conversation id -> newest message time seen in the list
		var listSeen = {};
		var finish = function () {
			crawlThreads(listSeen, !stopWhenNothingNew, function (fromThreads) {
				done(totalAdded + fromThreads);
			});
		};

		function fetchPage(path) {
			seen[path] = true;
			yair.view.showStatus("Reading message archive, page " + pageNum);
			yair.request('getArchivePage', {
				path: path
			}, function (response) {
				if (!response || response.__yairError || typeof response.html !== "string") {
					var reason = (response && response.__yairError) ? response.__yairError : "unexpected response";
					if (reason === yair.CONTEXT_GONE) return fail("Dead Letter Office was updated or reloaded. Reload this page to keep going.");
					fail("Couldn't load your message archive from Reddit (" + reason + "). Are you logged in on www.reddit.com?");
					return;
				}
				var page = yair.helper.parseArchiveHtml(response.html);
				page.conversations.forEach(function (c) {
					listSeen[c.id] = Math.max(listSeen[c.id] || 0, c.latest);
				});
				if (!page.messages.length) return finish();
				yair.proxy(['yair', 'db', 'addAll'], [db_tables.privateMessages.name, page.messages], function (numAdded) {
					totalAdded += numAdded || 0;
					var next = page.nextCandidates.filter(function (p) {
						return !seen[p];
					})[0];
					if (!next || (stopWhenNothingNew && !numAdded)) {
						return finish();
					}
					pageNum++;
					// Pace requests so Reddit doesn't rate limit the crawl
					setTimeout(function () {
						fetchPage(next);
					}, 400);
				});
			});
		}
		fetchPage('/message/messages/');
	}

	// The archive list only previews the latest few messages of each
	// conversation; its own page (/message/messages/<id>/) has all of them.
	// Fetch a conversation's page when it's new to us or has newer activity
	// than when we last read it. archiveThreads (per user, in the config)
	// remembers {conversation id: newest message time} for that, so an
	// interrupted run carries on where it left off.
	function crawlThreads(listSeen, forceAll, done) {
		var known = Object.assign({}, yair.cfg.data.archiveThreads || {});
		// Version 2 follows a conversation's "load more" chunks. Records from
		// earlier builds only saw the first chunk, so start those over.
		var THREADS_FORMAT = 2;
		if (known.__v !== THREADS_FORMAT) known = { __v: THREADS_FORMAT };
		var added = 0;
		yair.model.getConversations(function (stored) {
			var todo = [];
			var queue = function (id) {
				if (/^t4_[a-z0-9]+$/i.test(id) && todo.indexOf(id) < 0) todo.push(id);
			};
			Object.keys(listSeen).forEach(function (id) {
				if (forceAll || !(id in known) || listSeen[id] > known[id]) queue(id);
			});
			// Conversations stored earlier but never read in full
			stored.forEach(function (c) {
				if (!(c.id in known)) queue(c.id);
			});
			if (!todo.length) return done(0);
			var i = 0;
			var save = function () {
				yair.cfg.set('archiveThreads', known);
			};
			var next = function () {
				if (i >= todo.length) {
					save();
					return done(added);
				}
				var id = todo[i++];
				yair.view.showStatus("Reading full conversations, " + i + " of " + todo.length);
				yair.request('getArchivePage', {
					path: '/message/messages/' + id.substring(3) + '/'
				}, function (response) {
					var step = function () {
						if (i % 20 === 0) save();
						setTimeout(next, 250);
					};
					if (!response || response.__yairError || typeof response.html !== "string") {
						var reason = response && response.__yairError;
						if (reason === yair.CONTEXT_GONE) {
							save();
							return done(added);
						}
						// Gone on Reddit's side: don't keep asking. Anything else is retried next time.
						if (/HTTP (404|403)/.test(reason || "")) known[id] = 9e15;
						console.warn("DLO: couldn't read conversation " + id + ":", reason);
						return step();
					}
					var page = yair.helper.parseArchiveHtml(response.html, {
						rootName: id
					});
					var newest = listSeen[id] || 0;
					var subject = page.messages.length ? page.messages[0].subject : '';
					var store = function (msgs, then) {
						msgs.forEach(function (m) {
							if (m.created_utc > newest) newest = m.created_utc;
						});
						if (!msgs.length) return then();
						yair.proxy(['yair', 'db', 'addAll'], [db_tables.privateMessages.name, msgs], function (numAdded) {
							added += numAdded || 0;
							then();
						});
					};
					// Then follow the conversation's "load more" chunks until there are none left
					var seenChunks = {};
					var chunkQueue = page.replyPages.slice();
					var chunks = 0;
					var nextChunk = function () {
						var path = chunkQueue.shift();
						while (path && seenChunks[path]) path = chunkQueue.shift();
						if (!path || chunks >= 1000) {
							known[id] = newest;
							return step();
						}
						seenChunks[path] = true;
						chunks++;
						yair.view.showStatus("Reading full conversations, " + i + " of " + todo.length + " (older messages, part " + chunks + ")");
						setTimeout(function () {
							yair.request('getArchivePage', {
								path: path
							}, function (chunk) {
								if (!chunk || chunk.__yairError || typeof chunk.html !== "string") {
									// Leave this conversation unmarked so it's tried again next time
									console.warn("DLO: couldn't read part of conversation " + id + ":", chunk && chunk.__yairError);
									return step();
								}
								var part = yair.helper.parseArchiveHtml(chunk.html, {
									rootName: id
									, subject: subject
								});
								part.replyPages.forEach(function (p) {
									if (!seenChunks[p]) chunkQueue.push(p);
								});
								store(part.messages, nextChunk);
							});
						}, 250);
					};
					store(page.messages, nextChunk);
				});
			};
			next();
		});
	}

	// --- Parsing the new Reddit archive page -------------------------------

	function nameFromLink(a) {
		var href = a.getAttribute('href') || '';
		var m = href.match(/\/(?:user|u)\/([A-Za-z0-9_-]+)/);
		if (m) return m[1];
		m = href.match(/\/r\/([A-Za-z0-9_]+)/);
		if (m) return '#' + m[1];
		var text = a.textContent.trim();
		if (/^\/?r\//.test(text)) return '#' + text.replace(/^\/?r\//, '');
		return text.replace(/^\/?u\//, '') || null;
	}

	function timestampOf(el) {
		var time = el.querySelector('time[datetime]');
		var raw = time ? time.getAttribute('datetime') : null;
		if (!raw) {
			var ago = el.querySelector('faceplate-timeago[ts]');
			// "2025-03-27T14:26:42.746000+0000" -> something Date can parse
			raw = ago ? ago.getAttribute('ts').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d\d)(\d\d)$/, '$1:$2') : null;
		}
		var ms = raw ? Date.parse(raw) : NaN;
		return isNaN(ms) ? 0 : Math.floor(ms / 1000);
	}

	var BLOCK_TAGS = /^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6]|TR|TABLE|UL|OL|HR)$/;

	function htmlToText(el) {
		var out = '';
		(function walk(node) {
			node.childNodes.forEach(function (child) {
				if (child.nodeType === 3) {
					out += child.textContent;
				}
				else if (child.nodeType === 1) {
					if (child.tagName === 'BR') { out += '\n'; return; }
					if (child.tagName === 'LI') out += '* ';
					walk(child);
					if (BLOCK_TAGS.test(child.tagName)) out += '\n\n';
				}
			});
		})(el);
		return out.replace(/\n{3,}/g, '\n\n').trim();
	}

	// Keep Reddit's rendered formatting but nothing that could run or restyle the page
	function sanitizeHtml(el) {
		var clone = el.cloneNode(true);
		clone.querySelectorAll('script, style, iframe, object, embed, form, input, button, svg, link, meta').forEach(function (n) {
			n.remove();
		});
		[clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*'))).forEach(function (n) {
			Array.prototype.slice.call(n.attributes).forEach(function (attr) {
				var keep = (n.tagName === 'A' && (attr.name === 'href' || attr.name === 'title')) || (n.tagName === 'IMG' && (attr.name === 'src' || attr.name === 'alt'));
				if (!keep) n.removeAttribute(attr.name);
			});
			if (n.tagName === 'A') {
				var href = n.getAttribute('href') || '';
				if (!/^(https?:|\/|#|mailto:)/i.test(href.trim())) n.removeAttribute('href');
				n.setAttribute('target', '_blank');
				n.setAttribute('rel', 'noopener noreferrer');
			}
			if (n.tagName === 'IMG' && !/^https:/i.test(n.getAttribute('src') || '')) n.removeAttribute('src');
		});
		return '<div class="md">' + clone.innerHTML + '</div>';
	}

	// Older pages load from /svc/shreddit/pm-archive/<cursor>, where the cursor
	// is base64 of "<id>:<id>". Find the link in the markup (it lives on a
	// lazy faceplate-partial), falling back to a scan of the raw HTML.
	var ARCHIVE_PAGE_RE = /\/svc\/shreddit\/pm-archive\/[^"'\s<>]+/g;

	// The one sanitiser for message HTML, whichever way it was indexed
	yair.helper.sanitizeHtml = function (html) {
		if (!html) return '';
		var doc = new DOMParser().parseFromString('<div>' + String(html) + '</div>', 'text/html');
		return sanitizeHtml(doc.body.firstChild);
	};

	function findNextPage(doc, html) {
		var found = [];
		doc.querySelectorAll('[src*="/svc/shreddit/pm-archive/"], [href*="/svc/shreddit/pm-archive/"]').forEach(function (el) {
			found.push(el.getAttribute('src') || el.getAttribute('href'));
		});
		if (!found.length) {
			found = (html.match(ARCHIVE_PAGE_RE) || []).map(function (u) {
				return u.replace(/&amp;/g, '&');
			});
		}
		var pages = [];
		for (var i = found.length - 1; i >= 0; i--) {
			try {
				var url = new URL(found[i], 'https://www.reddit.com');
				if (url.origin === 'https://www.reddit.com') pages.push(url.pathname + url.search);
			}
			catch (e) {}
		}
		// Most likely "next" first
		return pages;
	}

	// Older messages of a long conversation load from
	// /svc/shreddit/pm-archive-message-replies/<conversation>/<cursor>
	var REPLY_PAGE_RE = /\/svc\/shreddit\/pm-archive-message-replies\/[^"'\s<>]+/g;

	function findReplyPages(doc, html) {
		var found = [];
		doc.querySelectorAll('[src*="/pm-archive-message-replies/"], [href*="/pm-archive-message-replies/"]').forEach(function (el) {
			found.push(el.getAttribute('src') || el.getAttribute('href'));
		});
		(html.match(REPLY_PAGE_RE) || []).forEach(function (u) {
			found.push(u.replace(/&amp;/g, '&'));
		});
		var pages = [];
		found.forEach(function (u) {
			try {
				var url = new URL(u, 'https://www.reddit.com');
				var path = url.pathname + url.search;
				if (url.origin === 'https://www.reddit.com' && pages.indexOf(path) < 0) pages.push(path);
			}
			catch (e) {}
		});
		return pages;
	}

	function parseMessageTemplate(m, subject) {
		var idEl = m.querySelector('[id^="pm-archive-overflow-menu-"]');
		var name = idEl ? idEl.id.replace('pm-archive-overflow-menu-', '') : '';
		if (!/^t4_[a-z0-9]+$/i.test(name)) return null;
		var share = m.querySelector('[permalink]');
		var permalinkId = share ? (share.getAttribute('permalink').match(/\/message\/messages\/([a-z0-9]+)/i) || [])[1] : null;
		var meta = m.querySelector('.text-neutral-content-weak') || m;
		var people = meta.querySelectorAll('a');
		var bodyEl = m.querySelector('[id$="post-rtjson-content"]') || m.querySelector('.text-14');
		return {
			id: name.substring(3)
			, name: name
			, author: (people[0] && nameFromLink(people[0])) || '[unknown]'
			, dest: people[1] ? nameFromLink(people[1]) : null
			, subject: subject
			, body: bodyEl ? htmlToText(bodyEl) : ''
			, body_html: bodyEl ? sanitizeHtml(bodyEl) : ''
			, created_utc: timestampOf(m)
			, 'new': false
			, distinguished: null
			, _root: permalinkId ? 't4_' + permalinkId.toLowerCase() : null
		};
	}

	// Parses an archive list page, a conversation page, or a chunk of a
	// conversation. Chunks carry bare messages with no conversation wrapper,
	// so `context` ({rootName, subject}) says which conversation they belong to.
	yair.helper.parseArchiveHtml = function (html, context) {
		var doc = new DOMParser().parseFromString(html, 'text/html');
		var messages = [];
		var conversations = [];
		var addConversation = function (convMessages, rootName) {
			if (!convMessages.length) return;
			if (!rootName) {
				// Fall back to the oldest message in the conversation
				rootName = convMessages.slice().sort(function (a, b) {
					return a.created_utc - b.created_utc;
				})[0].name;
			}
			conversations.push({
				id: rootName
				, latest: convMessages.reduce(function (t, m) { return Math.max(t, m.created_utc || 0); }, 0)
			});
			convMessages.forEach(function (msg) {
				msg.first_message_name = rootName;
				delete msg._root;
				messages.push(msg);
			});
		};
		doc.querySelectorAll('[data-test-id="pm-archive-conversation"]').forEach(function (conv) {
			var subjectLink = conv.querySelector('a');
			var subject = subjectLink ? subjectLink.textContent.trim() : '';
			var convMessages = [];
			var rootName = null;
			conv.querySelectorAll('[data-test-id="pm-archive-message-template"]').forEach(function (el) {
				var msg = parseMessageTemplate(el, subject);
				if (!msg) return;
				if (msg._root && !rootName) rootName = msg._root;
				convMessages.push(msg);
			});
			addConversation(convMessages, rootName || (context && context.rootName));
		});
		if (context) {
			var loose = [];
			doc.querySelectorAll('[data-test-id="pm-archive-message-template"]').forEach(function (el) {
				if (el.closest('[data-test-id="pm-archive-conversation"]')) return;
				var msg = parseMessageTemplate(el, context.subject || '');
				if (msg) loose.push(msg);
			});
			addConversation(loose, context.rootName);
		}
		return {
			messages: messages
			, conversations: conversations
			, nextCandidates: findNextPage(doc, html)
			, replyPages: findReplyPages(doc, html)
		};
	};

	// Walks Reddit's private message listing from newest to oldest, storing
	// every message that isn't in the local database yet. Reddit lists threads
	// by their latest activity, so when `stopWhenNothingNew` is set the walk
	// ends at the first page that added nothing.
	function crawlPrivateMessages(stopWhenNothingNew, done, fail) {
		var pageNum = 1;
		var totalAdded = 0;
		var failed = function (message) {
			if (typeof fail === "function") fail(message);
		};

		function fetchPage(after) {
			yair.view.showStatus("Indexing messages from page " + pageNum);
			yair.request('getPrivateMessages', {
				direction: after ? 'after' : null
				, reference: after
			}, function (response) {
				if (!response || response.__yairError || !response.data || !response.data.children) {
					var reason = (response && response.__yairError) ? response.__yairError : "unexpected response";
					if (reason === yair.CONTEXT_GONE) return failed("Dead Letter Office was updated or reloaded. Reload this page to keep going.");
					failed("Couldn't load your messages from Reddit (" + reason + "). Are you still logged in?");
					return;
				}
				var messages = extractPrivateMessages(response);
				if (!messages.length) return done(totalAdded);
				yair.proxy(['yair', 'db', 'addAll'], [db_tables.privateMessages.name, messages], function (numAdded) {
					totalAdded += numAdded || 0;
					var next = response.data.after;
					if (!next || (stopWhenNothingNew && !numAdded)) {
						return done(totalAdded);
					}
					pageNum++;
					fetchPage(next);
				});
			});
		}
		fetchPage(null);
	}

	function extractPrivateMessages(messageObj) {
		var messages = [];
		var children = messageObj.data.children;
		for (var i = 0; i < children.length; i++) {
			var obj = children[i];
			messages.push(dataObjToPrivateMessage(obj));
			if (obj.data.replies) {
				var replies = extractPrivateMessages(obj.data.replies);
				for (var j = 0; j < replies.length; j++) {
					messages.push(replies[j]);
				}
			}
		}
		return messages;
	}

	function dataObjToPrivateMessage(dataObj) {
		var msg = yair.helper.fixPrivateMessage(dataObj.data);
		return msg;
	}

	function getCorrespondentFromMsg(msg) {
		if (msg.author === getUsername()) { // Sent by me
			return msg.dest;
		}
		else if (msg.dest === getUsername()) { // Sent to me
			return msg.author;
		}
		else {
			return (msg.author && msg.author[0] === '#') ? msg.dest : msg.author;
		}
	}
	yair.model.getConversations = function (callback) {
		var queryParams = [db_tables.privateMessages.name, 'created_utc', true, 0, -1];
		yair.proxy(['yair', 'db', 'get'], queryParams, function (messages) {
			var conversations = yair.model.getConversationsFromMessages(messages);
			callback(conversations);
		});
	};
	yair.model.getConversation = function (name, callback) {
		var index = {
			key: 'first_message_name'
			, value: name
		};
		var queryParams = [db_tables.privateMessages.name, index, true, 0, -1];
		yair.proxy(['yair', 'db', 'get'], queryParams, function (messages) {
			var conversations = yair.model.getConversationsFromMessages(messages);
			if (!conversations.length) {
				yair.view.showNotification("That conversation isn't in your local inbox yet. Try Reindex Inbox in Settings.", 4000);
				return;
			}
			callback(conversations[0]);
		});
	};
	//yair_db.updateMessage bg func
	yair.model.getConversationsFromMessages = function (messages) {
		var conversations = {};
		for (var i = 0; i < messages.length; i++) {
			var obj = messages[i];
			if (!conversations[obj.first_message_name]) {
				conversations[obj.first_message_name] = {
					id: obj.first_message_name
					, modmail: false
					, subject: ''
					, last_author: obj.author
					, messages: []
					, text: obj.body
					, 'new': false
					, last_update: obj.created_utc
				};
			}
			var conversation = conversations[obj.first_message_name];
			conversation.messages.push(obj);
			conversation.subject = obj.subject;
			if (obj.created_utc > conversation.last_update) {
				conversation.last_update = obj.created_utc;
				conversation.last_author = obj.author;
			}
			if (obj['new']) conversation['new'] = true; // If any message is new, then the conversation is new
			if (obj.first_message_name === obj.name) {
				// This is the first message in the conversation, try get the correspondent from it
				conversation.correspondent = getCorrespondentFromMsg(obj);
				
				// If the first message is distinguished as 'moderator' we'll flag it modmail
				if (obj.distinguished && obj.distinguished === "moderator") {
					conversation.modmail = true;
				}
				
				if (obj.dest && obj.dest.charAt(0) === "#") {
					conversation.modmail = true;
				}

			}
			
		}
		var list = ObjectValues(conversations);
		// If the first message wasn't stored, work out who it's with from the oldest one we have
		list.forEach(function (conversation) {
			if (conversation.correspondent) return;
			var oldest = conversation.messages.slice().sort(function (a, b) {
				return a.created_utc - b.created_utc;
			})[0];
			conversation.correspondent = getCorrespondentFromMsg(oldest);
			if (oldest.dest && oldest.dest.charAt(0) === "#") conversation.modmail = true;
		});
		return list;
	};
})();
