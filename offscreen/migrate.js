// Offscreen document used once, after upgrading from the Manifest V2 build,
// to hand the old background page's localStorage to the service worker.
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
	if (!request || request.target !== 'offscreen' || request.action !== 'readLegacyLocalStorage') return;
	var copy = {};
	for (var i = 0; i < localStorage.length; i++) {
		var key = localStorage.key(i);
		copy[key] = localStorage.getItem(key);
	}
	sendResponse(copy);
});
