// Controller for your data: export, backup and restore, diagnostics, reindex, and reset.
(function ($) {
	Object.assign(yair.controller, {
		resetInbox: function () {
			yair.view.showLoading('Clearing inbox');
			yair.proxy(['yair', 'db', 'clearObjectStore'], [db_tables.privateMessages.name], function () {
				yair.model.invalidateConversations();
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
						format: 'dead-letter-office-backup'
						, version: 1
						, exported_utc: Math.floor(getTime() / 1000)
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
		// Restore a JSON backup: add its messages and flags, never remove anything
		, restoreBackup: function (file) {
			var fail = function (title, message) {
				yair.view.hideOverlay();
				setTimeout(function () { yair.alerts.error(title, message); }, 700);
			};
			var reader = new FileReader();
			reader.onerror = function () {
				fail("Couldn't read that file", 'The file could not be opened. Try saving it again and choosing it once more.');
			};
			reader.onload = function () {
				var data;
				try {
					data = JSON.parse(reader.result);
				}
				catch (e) {
					return fail("That isn't a backup file", "It isn't valid JSON. Choose a file made with Back up (JSON).");
				}
				var plan = yair.helper.planRestore(data, getUsername());
				if (plan.error) return fail("That backup can't be restored here", plan.error);
				yair.view.showLoading('Restoring ' + plan.messages.length + ' messages');
				var added = 0, i = 0, CHUNK = 500;
				var next = function () {
					if (i >= plan.messages.length) return finish();
					yair.view.showStatus('Restoring messages ' + (i + 1) + ' to ' + Math.min(i + CHUNK, plan.messages.length));
					yair.proxy(['yair', 'db', 'addAll'], [db_tables.privateMessages.name, plan.messages.slice(i, i + CHUNK)], function (n) {
						added += n || 0;
						i += CHUNK;
						next();
					});
				};
				var finish = function () {
					plan.saved.forEach(function (id) { yair.cfg.saved.add(id); });
					plan.archived.forEach(function (id) { yair.cfg.deleted.add(id); });
					if (!yair.cfg.data.pmInboxInitialized && added) yair.cfg.set('pmInboxInitialized', true);
					yair.model.invalidateConversations();
					yair.view.update();
					var skipped = plan.messages.length - added;
					setTimeout(function () {
						yair.alerts.alert('Backup restored', 'Added ' + added + ' messages from ' + plan.conversations + ' conversations' + (skipped ? ' (' + skipped + ' were already here)' : '') + '. Saved and archived flags were restored too.');
					}, 400);
				};
				next();
			};
			reader.readAsText(file);
		}
		, downloadDiagnostics: function () {
			yair.model.getConversations(function (conversations) {
				var messages = conversations.reduce(function (n, c) { return n + c.messages.length; }, 0);
				var cfg = yair.cfg.data;
				var report = {
					note: 'Dead Letter Office diagnostics. Contains no message text, subjects, or usernames.'
					, generated_utc: Math.floor(getTime() / 1000)
					, extension: yair.manifest.version
					, browser: navigator.userAgent
					, stored: {
						conversations: conversations.length
						, messages: messages
						, saved: (cfg.saved || []).length
						, archived: (cfg.deleted || []).length
						, conversationsReadInFull: Object.keys(cfg.archiveThreads || {}).filter(function (k) { return k !== '__v'; }).length
					}
					, settings: {
						indexed: !!cfg.pmInboxInitialized
						, sort: cfg.listSort
						, unreadCheckMs: cfg.inboxRefreshInterval
						, theme: cfg.nightMode
						, compact: !!cfg.compactMode
					}
					, lastIndexRun: cfg.indexStats || null
					, lastArchivePage: yair.model.cache.lastArchiveDiagnostics || null
				};
				downloadText('dead-letter-office-diagnostics_' + sysDateStr() + '.json', JSON.stringify(report, null, 2), 'application/json');
			});
		}
		, reindexMessages: function () {
			yair.view.showLoading('Reindexing inbox');
			yair.model.reindexPrivateMessages(function (added) {
				yair.view.update();
				yair.view.setFavicon();
				yair.view.showNotification('Reindex complete: ' + (added || 0) + ' new messages found', 2500);
			}, function (errorMessage) {
				console.error("DB has NOT been updated", arguments);
				yair.view.indexingFailed(errorMessage);
			});
		}
	});
})(jQuery);
