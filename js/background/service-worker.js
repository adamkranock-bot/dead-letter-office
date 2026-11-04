// Chrome (Manifest V3) background entry point. Firefox loads the same files as
// an event page through `background.scripts` in manifest.json instead, so keep
// this list in sync with that one.
importScripts(
	'../global/constants.js'
	, 'bg-global.js'
	, 'bg-storage.js'
	, 'bg-config.js'
	, 'bg-indexeddb.js'
	, 'bg-drafts.js'
	, 'bg_fetch.js'
	, 'bg-proxy.js'
);
