// Keyboard shortcuts: j/k, Enter/o, x, /, Esc/u, and n/N for search matches.
(function ($) {
	Object.assign(yair.view, {
		// j/k move through conversations, Enter/o opens, Esc/u goes back, / searches
		bindKeyboard: function () {
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
	});
})(jQuery);
