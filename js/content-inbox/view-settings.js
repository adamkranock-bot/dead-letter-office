// Settings dialog and theme.
(function ($) {
	Object.assign(dlo.view, {
		showConfig: function () {
			var $config = $(dlo.templates.config);
			$config.on('click', stopEvent);
			// TABS
			var contentTabs = {};
			var $contentTabs = $config.find('.dlo-config-content-panel .dlo-config-content');
			$contentTabs.each(function () {
				var $content = $(this);
				var name = $content.data('tab-content');
				contentTabs[name] = $content;
			});
			var $tabs = $config.find('.dlo-config-tabs .dlo-config-tab');
			$tabs.on('click', function () {
				var $tab = $(this);
				var name = $tab.data('tab');
				$tabs.removeClass('dlo-active-tab');
				$tab.addClass('dlo-active-tab');
				$contentTabs.removeClass('dlo-active-tab');
				contentTabs[name].addClass('dlo-active-tab');
			});
			// Buttons
			$config.find('#DLOResetInboxToggle').on('click', function () {
				$config.find('#DLOConfirmReset').removeClass('dlo-hide');
			});
			$config.find('#DLOResetInbox').on('click', function () {
				dlo.$e.overlay.empty().off();
				dlo.controller.resetInbox();
			});
			$config.find('#DLOReindexMessages').on('click', function () {
				dlo.$e.overlay.empty().off();
				dlo.controller.reindexMessages();
			});
			$config.find('.dlo-export-all').on('click', function () {
				dlo.controller.exportAll($(this).data('format'));
			});
			var $restoreFile = $config.find('#DLORestoreFile');
			$config.find('#DLORestoreButton').on('click', function () {
				$restoreFile.val('').trigger('click');
			});
			$restoreFile.on('change', function () {
				var file = this.files && this.files[0];
				if (!file) return;
				dlo.$e.body.removeClass('dlo-modal-open');
				dlo.controller.restoreBackup(file);
			});
			$config.find('#DLODiagnosticsButton').on('click', dlo.controller.downloadDiagnostics);
			$config.find('#DLOCancelResetInbox').on('click', function () {
				$config.find('#DLOConfirmReset').addClass('dlo-hide');
			});
			// Set checkbox-states
			var $showModMail = $config.find('#DLOShowModMail');
			$showModMail.prop('checked', dlo.cfg.data.showModmail);
			var $compactMode = $config.find('#DLOCompactMode');
			$compactMode.prop('checked', dlo.cfg.data.compactMode);

			var $nightMode = $config.find('#DLONightMode');
			$nightMode.val(dlo.cfg.data.nightMode === 'auto' ? 'auto' : (dlo.cfg.data.nightMode ? 'on' : 'off'));
			
			var $showNewFirst = $config.find('#DLONewFirst');
			$showNewFirst.prop('checked', dlo.cfg.data.conversationNewToOld);

			//set dropdown state
			var $inboxRefreshInterval = $config.find("#DLORefreshInterval");
			var currentInterval = String(dlo.cfg.data.inboxRefreshInterval);
			if (!$inboxRefreshInterval.find('option[value="' + currentInterval + '"]').length) {
				// A value from an older version that's no longer in the list
				var minutes = Math.round(+currentInterval / 60000);
				$('<option>').attr('value', currentInterval).text(minutes <= 1 ? 'Every minute' : 'Every ' + minutes + ' minutes').appendTo($inboxRefreshInterval);
			}
			$inboxRefreshInterval.val(currentInterval);
			
			// Save settings
			$config.find('.dlo-config-footer .dlo-save-button').on('click', function () {
				var showModmail = $showModMail.prop('checked');
				var compactMode = $compactMode.prop('checked');
				var nightModeChoice = $nightMode.val();
				var nightMode = nightModeChoice === 'auto' ? 'auto' : nightModeChoice === 'on';
				var showNewFirst = $showNewFirst.prop('checked');
				var inboxRefreshInterval = $inboxRefreshInterval.val();
				// Same element initLayout uses, so the setting can be turned off again
				dlo.$e.body.toggleClass('dlo-compact-mode', compactMode);
				dlo.cfg.set('showModmail', showModmail);
				dlo.cfg.set('compactMode', compactMode);
				dlo.cfg.set('nightMode', nightMode);
				dlo.view.applyTheme();
				dlo.cfg.set('conversationNewToOld', showNewFirst);
				dlo.cfg.set('inboxRefreshInterval', parseInt(inboxRefreshInterval, 10));
				if (dlo.show === "conversation") {
					dlo.view.showNotification("Refresh page for this to take effect");
				}
				else {
					dlo.view.showInbox(dlo.model.cache.conversations, false);
				}
				dlo.$e.body.removeClass('dlo-modal-open');
				dlo.view.hideOverlay();
			});
			dlo.$e.body.addClass('dlo-modal-open');
			dlo.$e.overlay.empty().append($config);
			dlo.view.showOverlay(true, function () {
				dlo.$e.body.removeClass('dlo-modal-open');
			});
			
			if ( !$("#new_modmail").length && !$("#modmail").length ) {
				$("#ModMail-config").css("display","none");
			}
			
		}
		// nightMode: false (light), true (dark), or 'auto' (follow the system setting)
		, applyTheme: function () {
			var mode = dlo.cfg.data.nightMode;
			var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
			var dark = mode === 'auto' ? !!(media && media.matches) : !!mode;
			dlo.$e.body.toggleClass('dlo-nightmode', dark);
			if (media && !dlo.model.cache.themeListener) {
				dlo.model.cache.themeListener = true;
				var onChange = function () {
					if (dlo.cfg.data.nightMode === 'auto') dlo.view.applyTheme();
				};
				if (media.addEventListener) media.addEventListener('change', onChange);
				else if (media.addListener) media.addListener(onChange);
			}
		}
	});
})(jQuery);
