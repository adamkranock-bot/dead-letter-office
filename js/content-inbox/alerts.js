dlo.templates.add({
	alert_alert: chrome.runtime.getURL('template/alert_alert.html')
	, alert_html: chrome.runtime.getURL('template/alert_html.html')
	, alert_confirm: chrome.runtime.getURL('template/alert_confirm.html')
});
dlo.alerts = {
	html: function (title, html, buttons, clickToDismiss) {
		var $alert = $(dlo.templates.alert_html);
		$alert.find('.dlo-alert-title-text').text(title);
		$alert.find('.dlo-alert-message').html(html);
		$alert.find('button.dlo-alert-close').on('click', dlo.view.hideOverlay);
		var $buttons = $alert.find('.dlo-alert-buttons');
		if (typeof buttons === "object") {
			var buttonTexts = Object.keys(buttons);
			for (var i = 0; i < buttonTexts.length; i++) {
				var text = buttonTexts[i];
				var callback = buttons[text];
				$('<button>').text(text).on('click', callback).on('click', dlo.view.hideOverlay).appendTo($buttons);
				$buttons.append(' ');
			}
		}
		if (typeof clickToDismiss !== "boolean") clickToDismiss = true;
		dlo.$e.overlay.empty().append($alert);
		dlo.view.showOverlay(clickToDismiss);
		return $alert;
	}
	, error: function (title, message) {
		dlo.alerts.alert(title, message, false).addClass('dlo-alert-error');
	}
	, alert: function (title, message, clickToDismiss) {
		var $alert = $(dlo.templates.alert_alert);
		$alert.find('.dlo-alert-title-text').text(title);
		$alert.find('.dlo-alert-message').text(message);
		$alert.find('button').on('click', dlo.view.hideOverlay);
		if (typeof clickToDismiss !== "boolean") clickToDismiss = true;
		dlo.$e.overlay.empty().append($alert);
		dlo.view.showOverlay(clickToDismiss);
		return $alert;
	}
	, confirm: function (title, message, callback) {
		var $alert = $(dlo.templates.alert_confirm);
		$alert.find('.dlo-alert-title-text').text(title);
		$alert.find('.dlo-alert-message').text(message);
		$alert.find('button').on('click', dlo.view.hideOverlay);
		$alert.find('.dlo-confirm-yes').on('click', callback);
		dlo.$e.overlay.empty().append($alert);
		dlo.view.showOverlay(false);
		return $alert;
	}
}