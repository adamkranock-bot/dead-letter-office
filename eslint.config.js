const globals = require('globals');

// The extension is plain browser scripts sharing globals across files (no
// bundler), so lint for real mistakes like undefined names and syntax errors
// rather than style.
const shared = {
	// constants.js
	ERROR: 'readonly', INFO: 'readonly', DEBUG: 'readonly', MONTHS: 'readonly',
	db_tables: 'readonly', db_mode: 'readonly',
	// time.js
	dloTime: 'readonly',
	chrome: 'readonly',
};

module.exports = [
	{
		ignores: ['node_modules/**', 'dist/**', '**/*.min.js', 'js/content-inbox/turndown.min.js'],
	},
	{
		files: ['js/**/*.js', 'offscreen/**/*.js'],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'script',
			globals: { ...globals.browser, ...shared },
		},
		rules: {
			'no-undef': 'error',
			'no-unused-vars': 'off',
			'no-redeclare': 'off',
			'no-empty': 'off',
			'no-useless-escape': 'off',
		},
	},
	{
		// Content scripts on the archive pages
		files: ['js/content-inbox/**/*.js', 'js/global/**/*.js'],
		languageOptions: {
			globals: {
				$: 'readonly', jQuery: 'readonly', Quill: 'readonly', TurndownService: 'readonly', SnuOwnd: 'readonly',
				dlo: 'writable',
				getUsername: 'readonly', isLoggedIn: 'readonly', htmlDecode: 'readonly', escapeHtml: 'readonly',
				decodeBasicEntities: 'readonly', safeFilename: 'readonly', downloadText: 'readonly',
				isMessageHTMLEncoded: 'readonly', throttle: 'readonly', ObjectValues: 'readonly', replaceAll: 'readonly',
				parseQueryString: 'readonly', getTime: 'readonly', sysDateStr: 'readonly',
				sysTimeStr: 'readonly', dateString: 'readonly', longDateString: 'readonly', isElementInViewport: 'readonly',
				killEvent: 'readonly', stopEvent: 'readonly', onExtLoaded: 'readonly', escapeRegExp: 'readonly',
			},
		},
	},
	{
		files: ['js/content-all/**/*.js'],
		languageOptions: { globals: { onExtLoaded: 'readonly' } },
	},
	{
		// Background: Chrome service worker or Firefox event page. No DOM, no localStorage
		// (except the guarded migration read in bg-storage.js).
		files: ['js/background/**/*.js'],
		languageOptions: {
			globals: {
				...globals.serviceworker,
				localStorage: 'readonly',
				dlo: 'writable', dloStorage: 'readonly', chromeCall: 'readonly',
				dlo_default_cfg: 'readonly', dloUserCfg: 'readonly', dloHasUserCfg: 'readonly', dlo_cfg_save: 'readonly',
				dlo_cfg_deleted: 'readonly', dlo_cfg_saved: 'readonly', USER_CONFIG_KEY: 'readonly',
				dloNotifications: 'readonly', actions: 'readonly', dloTimeNow: 'readonly', toPrivateMessageRecord: 'readonly',
				redditRequest: 'readonly',
			},
		},
		rules: {
			'no-restricted-globals': ['error',
				{ name: 'window', message: 'Not available in the MV3 service worker; use self.' },
				{ name: 'document', message: 'Not available in the MV3 service worker.' },
				{ name: '$', message: 'jQuery is not loaded in the background.' },
			],
		},
	},
	{
		files: ['scripts/**/*.mjs'],
		languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
	},
	{
		files: ['eslint.config.js', 'test/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			// Test callbacks passed to page.evaluate run in the browser
			globals: { ...globals.node, ...globals.browser, chrome: 'readonly', dloNotifications: 'readonly' },
		},
	},
];
