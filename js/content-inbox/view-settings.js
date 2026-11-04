// Settings dialog and theme.
(function ($) {
	Object.assign(yair.view, {
		showConfig: function () {
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
			var $restoreFile = $config.find('#DLORestoreFile');
			$config.find('#DLORestoreButton').on('click', function () {
				$restoreFile.val('').trigger('click');
			});
			$restoreFile.on('change', function () {
				var file = this.files && this.files[0];
				if (!file) return;
				yair.$e.body.removeClass('yair-modal-open');
				yair.controller.restoreBackup(file);
			});
			$config.find('#DLODiagnosticsButton').on('click', yair.controller.downloadDiagnostics);
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
	});
})(jQuery);
