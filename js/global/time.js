// Small date helpers that replace the moment.js dependency.
var yairTime = (function () {
	var UNITS = [
		['year', 60 * 60 * 24 * 365]
		, ['month', 60 * 60 * 24 * 30]
		, ['week', 60 * 60 * 24 * 7]
		, ['day', 60 * 60 * 24]
		, ['hour', 60 * 60]
		, ['minute', 60]
		, ['second', 1]
	];
	var rtf = (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) ? new Intl.RelativeTimeFormat(undefined, {
		numeric: 'auto'
	}) : null;
	var fullFormat = (typeof Intl !== 'undefined' && Intl.DateTimeFormat) ? new Intl.DateTimeFormat(undefined, {
		weekday: 'short'
		, year: 'numeric'
		, month: 'short'
		, day: '2-digit'
		, hour: 'numeric'
		, minute: '2-digit'
		, second: '2-digit'
		, timeZoneName: 'short'
	}) : null;
	return {
		// Current time as a unix timestamp (seconds)
		now: function () {
			return Math.floor(Date.now() / 1000);
		}
		// "5 minutes ago", "yesterday", ... for a unix timestamp (seconds)
		, fromNow: function (unixSeconds) {
			var diff = unixSeconds - yairTime.now();
			var abs = Math.abs(diff);
			for (var i = 0; i < UNITS.length; i++) {
				var unit = UNITS[i];
				if (abs >= unit[1] || unit[0] === 'second') {
					var value = Math.round(diff / unit[1]);
					if (rtf) return rtf.format(value, unit[0]);
					return Math.abs(value) + ' ' + unit[0] + (Math.abs(value) === 1 ? '' : 's') + (value < 0 ? ' ago' : ' from now');
				}
			}
		}
		// Long, local, human readable date for tooltips
		, full: function (unixSeconds) {
			var d = new Date(unixSeconds * 1000);
			return fullFormat ? fullFormat.format(d) : d.toString();
		}
	};
})();
