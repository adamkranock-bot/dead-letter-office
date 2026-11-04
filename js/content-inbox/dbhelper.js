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
				crawlPrivateMessages(true, success, error);
			}
			else {
				// First run (or after a reset): index everything Reddit will give us
				crawlPrivateMessages(false, function () {
					yair.cfg.set('pmInboxInitialized', true);
					success();
				}, error);
			}
		});
	};
	yair.model.reindexPrivateMessages = function (success, error) {
		crawlPrivateMessages(false, success, error);
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
		return ObjectValues(conversations);
	};
})();
