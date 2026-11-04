// Controller for your data: export, backup and restore, diagnostics, reindex, and reset.
(function ($) {
	Object.assign(dlo.controller, {
		resetInbox: function () {
			dlo.view.showLoading('Clearing inbox');
			dlo.proxy(['dlo', 'db', 'clearObjectStore'], [db_tables.privateMessages.name], function () {
				dlo.model.invalidateConversations();
				dlo.cfg.set('pmInboxInitialized', false);
				dlo.cfg.set('archiveThreads', {});
				dlo.controller.reloadInbox();
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
			var conversation = $('.dlo-conversation').data('conversation');
			if (!conversation) { return; }
			var last = conversation.last_update || getTime() / 1000;
			var filename = safeFilename(conversation.subject) + '_' + sysDateStr(last * 1000) + '_' + sysTimeStr(last * 1000, '-') + '.txt';
			downloadText(filename, dlo.controller.conversationToText(conversation));
		}
		// Download every stored conversation, as plain text or JSON
		, exportAll: function (format) {
			dlo.view.showLoading('Preparing export');
			dlo.model.getConversations(function (conversations) {
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
							, saved: dlo.cfg.saved.contains(c.id)
							, archived: dlo.cfg.deleted.contains(c.id)
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
					downloadText(base + '.txt', conversations.map(dlo.controller.conversationToText).join("\r\n---\r\n---\r\n"));
				}
				dlo.view.showNotification('Exported ' + conversations.length + ' conversations');
			});
		}
		// Restore a JSON backup: add its messages and flags, never remove anything
		, restoreBackup: function (file) {
			var fail = function (title, message) {
				dlo.view.hideOverlay();
				setTimeout(function () { dlo.alerts.error(title, message); }, 700);
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
				var plan = dlo.helper.planRestore(data, getUsername());
				if (plan.error) return fail("That backup can't be restored here", plan.error);
				dlo.view.showLoading('Restoring ' + plan.messages.length + ' messages');
				var added = 0, i = 0, CHUNK = 500;
				var next = function () {
					if (i >= plan.messages.length) return finish();
					dlo.view.showStatus('Restoring messages ' + (i + 1) + ' to ' + Math.min(i + CHUNK, plan.messages.length));
					dlo.proxy(['dlo', 'db', 'addAll'], [db_tables.privateMessages.name, plan.messages.slice(i, i + CHUNK)], function (n) {
						added += n || 0;
						i += CHUNK;
						next();
					});
				};
				var finish = function () {
					plan.saved.forEach(function (id) { dlo.cfg.saved.add(id); });
					plan.archived.forEach(function (id) { dlo.cfg.deleted.add(id); });
					if (!dlo.cfg.data.pmInboxInitialized && added) dlo.cfg.set('pmInboxInitialized', true);
					dlo.model.invalidateConversations();
					dlo.view.update();
					var skipped = plan.messages.length - added;
					setTimeout(function () {
						dlo.alerts.alert('Backup restored', 'Added ' + added + ' messages from ' + plan.conversations + ' conversations' + (skipped ? ' (' + skipped + ' were already here)' : '') + '. Saved and archived flags were restored too.');
					}, 400);
				};
				next();
			};
			reader.readAsText(file);
		}
		, downloadDiagnostics: function () {
			dlo.model.getConversations(function (conversations) {
				var messages = conversations.reduce(function (n, c) { return n + c.messages.length; }, 0);
				var cfg = dlo.cfg.data;
				var report = {
					note: 'Dead Letter Office diagnostics. Contains no message text, subjects, or usernames.'
					, generated_utc: Math.floor(getTime() / 1000)
					, extension: dlo.manifest.version
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
					, lastArchivePage: dlo.model.cache.lastArchiveDiagnostics || null
				};
				downloadText('dead-letter-office-diagnostics_' + sysDateStr() + '.json', JSON.stringify(report, null, 2), 'application/json');
			});
		}
		, reindexMessages: function () {
			dlo.view.showLoading('Reindexing inbox');
			dlo.model.reindexPrivateMessages(function (added) {
				dlo.view.update();
				dlo.view.setFavicon();
				dlo.view.showNotification('Reindex complete: ' + (added || 0) + ' new messages found', 2500);
			}, function (errorMessage) {
				console.error("DB has NOT been updated", arguments);
				dlo.view.indexingFailed(errorMessage);
			});
		}
	});
})(jQuery);
