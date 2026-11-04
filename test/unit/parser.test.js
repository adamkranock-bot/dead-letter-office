// Unit tests for the archive parser, sanitiser, restore planning, and search,
// run in a real browser page with the extension's content scripts loaded.
// The main fixture is the real structure of Reddit's archive page (text
// redacted), so a change in how we parse it shows up here first.
//
//   npm run test:unit
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = fs.readFileSync(path.join(ROOT, 'test/fixtures/archive-conversation.html'), 'utf8');
const SCRIPTS = [
	'js/content-inbox/jquery-3.7.1.min.js',
	'js/global/constants.js',
	'js/global/time.js',
	'js/content-inbox/global.js',
	'js/content-inbox/generic.js',
	'js/content-inbox/search.js',
	'__setup__',
	'js/content-inbox/dbhelper.js',
];

const results = [];
function check(name, cond, detail) {
	results.push(!!cond);
	console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && !cond ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}

(async () => {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	await page.setContent('<!DOCTYPE html><html><body></body></html>');
	// Just enough of the extension APIs for the content scripts to load
	await page.evaluate(() => {
		window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), getURL: (p) => p, sendMessage() {}, lastError: null } };
	});
	for (const file of SCRIPTS) {
		if (file === '__setup__') {
			await page.evaluate(() => {
				dlo.model = { cache: {} };
				dlo.view = { showStatus() {}, showNotification() {} };
			});
			continue;
		}
		await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, file), 'utf8') });
	}
	const run = (fn, ...args) => page.evaluate(fn, ...args);

	// --- Real archive markup ---------------------------------------------
	const parsed = await run((html) => dlo.helper.parseArchiveHtml(html), FIXTURE);
	check('real markup: one conversation found', parsed.conversations.length === 1 && parsed.conversations[0].id === 't4_abc123', parsed.conversations);
	const m = parsed.messages[0] || {};
	check('real markup: message id from the overflow-menu id', parsed.messages.length === 1 && m.name === 't4_ID' && m.id === 'ID', m);
	check('real markup: conversation from the share permalink', m.first_message_name === 't4_abc123', m.first_message_name);
	check('real markup: timestamp from <time datetime>', m.created_utc === Math.floor(Date.parse('2025-03-27T14:26:42.746Z') / 1000), m.created_utc);
	check('real markup: author, recipient, and subject read', m.author === 'x' && m.dest === 'x' && m.subject === 'x', m);
	check('real markup: body text extracted', /x/.test(m.body) && m.body.split('\n\n').length >= 2, m.body);
	check('real markup: body HTML sanitised (Reddit classes and junk links dropped, links opened safely)', /^<div class="md"><p>/.test(m.body_html) && (m.body_html.match(/class=/g) || []).length === 1 && !/href="x"/.test(m.body_html) && /rel="noopener noreferrer"/.test(m.body_html), m.body_html);

	// --- Layout-change detection -----------------------------------------
	const described = await run((html) => dlo.helper.describeArchivePage(html), FIXTURE);
	check('describe: sees the archive markup and one dated item', described.mentionsPmArchive && described.timestamps === 1 && described.parsed.messages === 1, described);
	const changed = FIXTURE.replace(/pm-archive-message-template/g, 'pm-archive-letter-v2');
	const changedParsed = await run((html) => ({ p: dlo.helper.parseArchiveHtml(html).messages.length, d: dlo.helper.describeArchivePage(html) }), changed);
	check('describe: a renamed message block reads as "changed", not "empty"', changedParsed.p === 0 && changedParsed.d.mentionsPmArchive && changedParsed.d.timestamps > 0, changedParsed);
	const empty = '<html><body><main><div data-test-id="pm-archive-empty">x</div></main></body></html>';
	const emptyDescribed = await run((html) => dlo.helper.describeArchivePage(html), empty);
	check('describe: an empty archive has no dated items', emptyDescribed.timestamps === 0, emptyDescribed);
	const secret = FIXTURE.replace('<p>x', '<p>SECRET-TEXT x').replace('href="x"', 'href="/user/SecretUser/"');
	const leak = JSON.stringify(await run((html) => dlo.helper.describeArchivePage(html), secret));
	check('describe: diagnostics never include message text or usernames', !/SECRET-TEXT|SecretUser/.test(leak), leak.slice(0, 200));

	// --- Sanitiser --------------------------------------------------------
	const clean = await run(() => dlo.helper.sanitizeHtml('<p onclick="x()" style="color:red">hi<script>bad()</script><a href="javascript:alert(1)">j</a> <a href="https://example.com/">ok</a><img src="http://e.com/a.png"><iframe src="https://e.com"></iframe></p>'));
	check('sanitiser: no scripts, handlers, styles, iframes, or javascript: links', !/script|onclick|style=|iframe|javascript:/i.test(clean), clean);
	check('sanitiser: keeps https links (opened safely) and drops insecure images', /href="https:\/\/example.com\/"/.test(clean) && /rel="noopener noreferrer"/.test(clean) && !/http:\/\/e.com\/a.png/.test(clean), clean);
	check('sanitiser: empty input gives empty output', (await run(() => dlo.helper.sanitizeHtml(''))) === '');

	// --- Restore planning -------------------------------------------------
	const backup = {
		format: 'dead-letter-office-backup', version: 1, username: 'alice',
		conversations: [
			{ id: 't4_aaa', subject: 'Hello', saved: true, archived: false, messages: [
				{ id: 'aaa', name: 't4_aaa', author: 'bob', dest: 'alice', body: 'hi', body_html: '<p>hi</p>', created_utc: 100, first_message_name: 't4_aaa', subject: 'Hello', extra: 'dropped' },
				{ name: 't4_aab', author: 'alice', body: 'yo', created_utc: '101' },
				{ name: 'not-a-message' },
			] },
			{ id: 't4_bbb', archived: true, messages: [] },
		],
	};
	const plan = await run((b) => dlo.helper.planRestore(b, 'Alice'), backup);
	check('restore: valid backup planned (username match ignores case)', !plan.error && plan.messages.length === 2 && plan.conversations === 1, plan);
	check('restore: records normalised and unknown fields dropped', plan.messages[1].id === 'aab' && plan.messages[1].first_message_name === 't4_aaa' && plan.messages[1].created_utc === 101 && plan.messages[0].extra === undefined, plan.messages);
	check('restore: saved flag kept; empty conversations skipped', plan.saved.join() === 't4_aaa' && plan.archived.length === 0, plan);
	const wrongUser = await run((b) => dlo.helper.planRestore(b, 'mallory'), backup);
	check('restore: refuses another account\'s backup', /belongs to u\/alice/.test(wrongUser.error || ''), wrongUser);
	const notBackup = await run(() => dlo.helper.planRestore({ hello: 1 }, 'alice'));
	check('restore: rejects files that aren\'t backups', /doesn't look like/.test(notBackup.error || ''), notBackup);

	// --- Search -----------------------------------------------------------
	const searched = await run(() => {
		const conv = { id: 't4_c', subject: 'Café plans', correspondent: 'Zoë', last_update: 1700000000, modmail: false, messages: [
			{ name: 't4_c', author: 'Zoë', dest: 'me', body: 'Meet at the crème brûlée place?', created_utc: 1700000000 },
		] };
		const flags = { saved: () => false, archived: () => false };
		const q = (s) => dlo.search.match(conv, dlo.search.parse(s, 'me'), flags).ok;
		return {
			accents: q('cafe') && q('creme brulee') && q('from:zoe'),
			phrase: q('"brûlée place"') && !q('"place brûlée"'),
			exclude: !q('cafe -creme'),
			or: q('pizza OR plans'),
			dates: q('during:2023-11') && !q('before:2023'),
			excerpt: dlo.search.excerpt('a '.repeat(80) + 'needle ' + 'b '.repeat(80), ['needle']).includes('needle'),
		};
	});
	Object.keys(searched).forEach((k) => check('search: ' + k, searched[k]));

	await browser.close();
	const failed = results.filter((r) => !r).length;
	console.log(`\n${results.length - failed}/${results.length} unit checks passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
