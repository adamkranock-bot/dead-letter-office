// End-to-end test: loads the unpacked extension in Chromium and drives it
// against a mock Reddit. Run with `npm run test:e2e` (needs openssl on PATH).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMockReddit } = require('./mock-reddit');

const EXT = process.env.DLO_EXT ? path.resolve(process.env.DLO_EXT) : path.resolve(__dirname, '..', '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dlo-e2e-'));
const PROFILE = path.join(DIR, 'profile');
let PORT = 0;
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}
async function mockLog(page) {
  return page.evaluate(() => fetch('https://old.reddit.com/__log').then(r => r.json()));
}
async function launch(profile = PROFILE) {
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      `--host-resolver-rules=MAP *.reddit.com 127.0.0.1:${PORT}, MAP reddit.com 127.0.0.1:${PORT}`,
      '--ignore-certificate-errors', '--no-proxy-server',
    ],
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  return { ctx, sw, extId };
}

(async () => {
  // Self-signed certificate for the mock; Chromium is told to accept it
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(DIR, 'key.pem'),
    '-out', path.join(DIR, 'cert.pem'), '-days', '1', '-subj', '/CN=reddit.com',
    '-addext', 'subjectAltName=DNS:reddit.com,DNS:*.reddit.com'], { stdio: 'ignore' });
  const server = createMockReddit({ key: fs.readFileSync(path.join(DIR, 'key.pem')), cert: fs.readFileSync(path.join(DIR, 'cert.pem')) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
  console.log('mock reddit on port ' + PORT + ', artifacts in ' + DIR);
  let { ctx, sw, extId } = await launch();
  const errors = [];
  ctx.on('weberror', e => errors.push(String(e.error())));
  sw.on('console', m => { if (m.type() === 'error') errors.push('[sw] ' + m.text()); });

  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('[page] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[page console] ' + m.text() + ' @ ' + JSON.stringify(m.location())); });
  page.on('requestfailed', r => errors.push('[reqfail] ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push('[http ' + r.status() + '] ' + r.url()); });

  // 1. First load: full index
  await page.goto('https://old.reddit.com/message/dlo_inbox');
  await page.waitForSelector('.dlo-message-row', { timeout: 20000 });
  await page.waitForTimeout(800);
  let rows = await page.locator('.dlo-message-row').count();
  check('full index renders all 13 conversations', rows === 13, rows);
  let log = await mockLog(page);
  const listingCalls = () => log.filter(e => e.path === '/message/messages.json');
  check('full index walked all 3 pages', listingCalls().length === 3, listingCalls().map(e => e.query));
  check('unread conversation is highlighted', await page.locator('.dlo-message-row.dlo-unread').count() === 1);
  check('subreddit correspondent links to /r/', (await page.locator('.dlo-correspondent a', { hasText: '#modsub' }).getAttribute('href')) === 'https://www.reddit.com/r/modsub');
  check('no script injection via subject', await page.evaluate(() => window.__xss) === undefined);
  check('bulk "Mark Selected Read" is bound to mark read', await page.locator('#DLOBulkMarkRead').innerText().then(t => t.includes('Mark Selected Read')));

  // 1b. Rebrand: old YAIR addresses still work and show the new address
  await page.goto('https://old.reddit.com/message/yair_inbox');
  await page.waitForSelector('.dlo-message-row');
  check('old /message/yair_inbox links redirect to /message/dlo_inbox', page.url().endsWith('/message/dlo_inbox'), page.url());
  check('page title and wordmark say Dead Letter Office', (await page.title()) === 'Dead Letter Office' && (await page.locator('.dlo-full').innerText()) === 'Dead Letter Office', await page.title());

  // 2. Search with message: prefix (used to throw)
  await page.fill('#DLOSearchInput', 'message:magicword');
  await page.press('#DLOSearchInput', 'Enter');
  await page.waitForTimeout(600);
  rows = await page.locator('.dlo-message-row').count();
  check('search "message:magicword" finds 1 conversation', rows === 1, rows);
  await page.fill('#DLOSearchInput', 'subject:Project &');
  await page.press('#DLOSearchInput', 'Enter');
  await page.waitForTimeout(600);
  rows = await page.locator('.dlo-message-row').count();
  check('search with "&" survives the URL round trip', rows === 1, { rows, url: page.url() });
  await page.click('.dlo-sidebar-nav.inbox .dlo-inbox');
  await page.waitForTimeout(600);

  // 2b. Archive-viewer UI
  const summary = await page.locator('.dlo-summary').innerText();
  check('summary line shows counts and date range', /13 conversations, 14 messages from Oct 2025/.test(summary), summary);
  await page.fill('#DLOSearchInput', 'filler');
  await page.waitForTimeout(900);
  rows = await page.locator('.dlo-message-row').count();
  check('search updates as you type (no Enter)', rows === 10, rows);
  check('matches are highlighted', await page.locator('.dlo-inbox-panel mark').count() >= 10);
  check('summary shows match count while searching', (await page.locator('.dlo-summary').innerText()).includes('10 of 13 conversations match'));
  await page.click('#DLOSearchClear');
  await page.waitForTimeout(700);
  check('clear button restores the full list', await page.locator('.dlo-message-row').count() === 13 && !page.url().includes('search='));

  // 2a0. Browsing works from the page's copy instead of re-reading the database
  await sw.evaluate(() => {
    self.__dbGets = 0;
    const original = dlo.db.get;
    dlo.db.get = function () { self.__dbGets++; return original.apply(this, arguments); };
  });
  for (const folder of ['.dlo-saved', '.dlo-archived', '.dlo-inbox']) {
    await page.click('.dlo-sidebar-nav.inbox ' + folder);
    await page.waitForTimeout(300);
  }
  await page.fill('#DLOSearchInput', 'filler');
  await page.waitForTimeout(700);
  await page.click('#DLOSearchClear');
  await page.waitForTimeout(500);
  check('switching folders and searching don\'t re-read the database', await sw.evaluate(() => self.__dbGets) === 0, await sw.evaluate(() => self.__dbGets));

  // 2a. Search syntax
  const searchFor = async (q) => {
    await page.fill('#DLOSearchInput', q);
    await page.press('#DLOSearchInput', 'Enter');
    await page.waitForTimeout(500);
    return page.locator('.dlo-message-row').count();
  };
  check('search: "exact phrase" matches words in order', await searchFor('"magicword is"') === 1 && await searchFor('"is magicword"') === 0);
  check('search: -"phrase" excludes', await searchFor('filler -"thread 3"') === 9);
  check('search: OR matches either', await searchFor('magicword OR rules') === 2);
  check('search: from: matches part of a name', await searchFor('from:ali') === 1);
  check('search: accents are ignored', await searchFor('alicé') === 1);
  check('search: messages:>1 by thread length', await searchFor('messages:>1') === 1);
  check('search: during:/before: by date', await searchFor('during:2025') === 13 && await searchFor('before:2020') === 0);
  check('search: is:unread', await searchFor('is:unread') === 1);
  check('search: unknown operators are searched as text', await searchFor('http:nothing-here') === 0);
  await searchFor('"line two"');
  const snippet = await page.locator('.dlo-message-row .dlo-text').first().innerText();
  check('search: row shows the matching message, not the latest one', snippet.startsWith('alice:') && snippet.includes('Line two'), snippet);
  check('search: match highlighted in the excerpt', (await page.locator('.dlo-message-row .dlo-text mark').first().innerText()) === 'Line two');
  await page.click('.dlo-message-row:has-text("Hello there")');
  await page.waitForSelector('.dlo-findbar');
  check('search: conversation opens on the match with a find bar', (await page.locator('.dlo-findbar-label').innerText()) === '1 of 1 match' && (await page.locator('.dlo-pm-body mark.dlo-current').innerText()) === 'Line two');
  check('search: the matching message is expanded', await page.locator('.dlo-search-hit:not(.dlo-collapsed)').count() === 1);
  await page.click('.dlo-findbar-clear');
  check('search: Clear removes highlights from the conversation', await page.locator('.dlo-conversation mark').count() === 0 && await page.locator('.dlo-findbar').count() === 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dlo-message-row');
  await page.click('#DLOSearchClear');
  await page.waitForTimeout(500);
  await page.locator('#DLOSearchInput').focus();
  check('search: cheat-sheet appears under the empty search box', await page.locator('.dlo-search-help').isVisible());
  await page.locator('#DLOSearchInput').blur();
  await page.waitForTimeout(200);
  check('message count badge on multi-message conversations', (await page.locator('.dlo-message-row:has-text("Hello there") .dlo-message-count').innerText()) === '2');
  await page.locator('body').click({ position: { x: 600, y: 5 } }).catch(() => {});
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  check('j/k moves keyboard focus', await page.locator('.dlo-message-row.dlo-row-focused').count() === 1);
  const focusedSubject = await page.locator('.dlo-row-focused .dlo-subject').innerText();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.dlo-conversation');
  check('Enter opens the focused conversation', (await page.locator('.dlo-conversation-title').innerText()) === focusedSubject, focusedSubject);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dlo-message-row');
  check('Esc returns to the list', page.url().endsWith('/message/dlo_inbox'));
  await page.screenshot({ path: path.join(DIR, 'inbox-light.png') });

  // 2c. Sort and filter by thread length, year, and who wrote last
  const rowCount = () => page.locator('.dlo-message-row').count();
  await page.selectOption('#DLOSort', 'most');
  await page.waitForTimeout(400);
  check('sort by most messages puts the longest thread first', (await page.locator('.dlo-message-row .dlo-subject').first().innerText()) === 'Hello there');
  check('length sort groups by thread size', (await page.locator('.dlo-year-divider').first().innerText()) === '2 to 4 messages', await page.locator('.dlo-year-divider').allInnerTexts());
  await page.selectOption('#DLOSort', 'fewest');
  await page.waitForTimeout(400);
  check('sort by fewest messages puts it last', (await page.locator('.dlo-message-row .dlo-subject').last().innerText()) === 'Hello there');
  await page.click('.dlo-length-preset:text-is("2+")');
  await page.waitForTimeout(400);
  check('"2+" preset keeps only multi-message threads', await rowCount() === 1 && (await page.locator('.dlo-summary').innerText()).includes('1 of 13 conversations match'));
  await page.click('.dlo-length-preset:text-is("1")');
  await page.waitForTimeout(400);
  check('"1" preset keeps only single-message threads', await rowCount() === 12);
  await page.click('.dlo-length-preset:text-is("Any")');
  await page.fill('#DLOMinMessages', '2');
  await page.fill('#DLOMaxMessages', '3');
  await page.waitForTimeout(700);
  check('min/max message range filters', await rowCount() === 1);
  await page.fill('#DLOMinMessages', '3');
  await page.waitForTimeout(700);
  check('range with no matches shows a hint', await rowCount() === 0 && (await page.locator('.dlo-empty-state').innerText()).includes('widening'));
  await page.click('.dlo-summary-clear:text-is("Clear filters")');
  await page.waitForTimeout(400);
  check('Clear filters restores everything and empties the inputs', await rowCount() === 13 && (await page.inputValue('#DLOMinMessages')) === '');
  await page.selectOption('#DLOLastFrom', 'me');
  await page.waitForTimeout(400);
  check('"last message from me" filter', await rowCount() === 1);
  await page.selectOption('#DLOLastFrom', 'them');
  await page.waitForTimeout(400);
  check('"last message from them" filter', await rowCount() === 12);
  await page.selectOption('#DLOLastFrom', '');
  const years = await page.locator('#DLOYear option').allInnerTexts();
  await page.selectOption('#DLOYear', '2025');
  await page.waitForTimeout(400);
  check('year filter lists the years present and filters by them', years.includes('2025') && await rowCount() === 13, years);
  await page.selectOption('#DLOYear', '');
  await page.selectOption('#DLOSort', 'az');
  await page.waitForTimeout(400);
  const names = await page.locator('.dlo-correspondent a.author').allInnerTexts();
  check('A to Z sort orders by name', names[0] === 'alice' && names[names.length - 1] === '#modsub', names);
  await page.selectOption('#DLOSort', 'most');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('.dlo-message-row');
  check('chosen sort is remembered after a reload', (await page.inputValue('#DLOSort')) === 'most');
  await page.selectOption('#DLOSort', 'newest');
  await page.waitForTimeout(400);

  // 3. Open a conversation
  const logBeforeOpen = (await mockLog(page)).length;
  await page.click('.dlo-message-row:has-text("Hello there")');
  await page.waitForSelector('.dlo-conversation');
  await page.waitForTimeout(800);
  check('conversation shows both messages', await page.locator('.dlo-private-message').count() === 2);
  log = await mockLog(page);
  const readCalls = log.slice(logBeforeOpen).filter(e => e.path === '/api/read_message' && e.body.id.includes('t4_a1'));
  check('read_message sent once, batched, only for received messages', readCalls.length === 1 && readCalls[0].body.id === 't4_a1', readCalls.map(e => e.body));
  const title = await page.locator('.dlo-message-date-string').first().getAttribute('title');
  check('date tooltip rendered without moment.js', !!title && /20\d\d/.test(title), title);

  // 4. Clicking the sidebar "Archived" icon from a conversation must not archive it
  await page.click('.dlo-sidebar-nav.inbox .dlo-archived .icon-archive');
  await page.waitForTimeout(800);
  rows = await page.locator('.dlo-message-row').count();
  check('sidebar archive icon does not archive the open conversation', rows === 0 && page.url().endsWith('dlo_archived'), { rows, url: page.url() });

  // 5. Read-only: no reply box, just the archive notice
  await page.click('.dlo-sidebar-nav.inbox .dlo-inbox');
  await page.waitForTimeout(500);
  await page.click('.dlo-message-row:has-text("Hello there")');
  await page.waitForSelector('.dlo-conversation');
  check('archive notice with a Reddit Chat link, and no reply box', await page.locator('.dlo-archive-notice a[href="https://chat.reddit.com/"]').isVisible() && await page.locator('textarea, .ql-editor, .dlo-message-editor').count() === 0);

  // 7. Export one conversation
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#DLOExportConversation')]);
  let text = fs.readFileSync(await dl.path(), 'utf8');
  check('conversation export has every line break converted', text.includes('Line one\r\nLine two\r\nLine three'), text.slice(0, 200));
  check('export filename is filesystem safe', /^Hello there_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.txt$/.test(dl.suggestedFilename()), dl.suggestedFilename());

  // 8. Archive from the conversation header
  await page.click('.conversation-header-right .icon-archive');
  await page.waitForTimeout(1200);
  rows = await page.locator('.dlo-message-row').count();
  check('archiving from conversation returns to inbox without it', rows === 12 && page.url().endsWith('dlo_inbox'), { rows, url: page.url() });
  await page.click('.dlo-sidebar-nav.inbox .dlo-archived');
  await page.waitForTimeout(600);
  check('archived folder lists it', await page.locator('.dlo-message-row').count() === 1);
  await page.click('.dlo-sidebar-nav.inbox .dlo-inbox');
  await page.waitForTimeout(600);

  // 9. Export everything as JSON from settings
  await page.click('#DLOShowConfig');
  await page.click('.dlo-config-tab[data-tab="admin"]');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('.dlo-export-all[data-format="json"]')]);
  const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const BACKUP = path.join(DIR, 'backup.json');
  fs.writeFileSync(BACKUP, JSON.stringify(exp));
  const hello = exp.conversations.find(c => c.subject === 'Hello there');
  check('export-all JSON has every conversation with flags', exp.conversations.length === 13 && hello.archived === true && hello.messages.length === 2, { n: exp.conversations.length, archived: hello && hello.archived });
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await page.waitForTimeout(800);

  // 10. Reload: nothing new -> one listing request
  const beforeReload = (await mockLog(page)).filter(e => e.path === '/message/messages.json').length;
  await page.reload();
  await page.waitForSelector('.dlo-message-row');
  await page.waitForTimeout(800);
  const afterReload = (await mockLog(page)).filter(e => e.path === '/message/messages.json').length;
  check('reload with nothing new fetches a single page', afterReload - beforeReload === 1, afterReload - beforeReload);

  // 11. Settings survive (stored in chrome.storage via the service worker)
  const cfg = await sw.evaluate(() => chrome.storage.local.get('DLO_USER_CONFIG'));
  check('archived id persisted in chrome.storage', cfg.DLO_USER_CONFIG.testuser.deleted.includes('t4_a1'), cfg.DLO_USER_CONFIG.testuser.deleted);

  // 11a. Upgrading from YAIR-era names: settings key and message database carry over
  const migrated = await sw.evaluate(async () => {
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    // A YAIR-era database for a user this profile hasn't opened yet
    const open = indexedDB.open('YAIR_Messages' + 'olduser', 4);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore('privateMessages', { keyPath: 'id' });
      ['author', 'created_utc', 'first_message_name'].forEach((i) => store.createIndex(i, i, { unique: false }));
    };
    const legacy = await req(open);
    const tx = legacy.transaction('privateMessages', 'readwrite');
    tx.objectStore('privateMessages').put({ id: 'm1', name: 't4_m1', first_message_name: 't4_m1', author: 'a', created_utc: 1 });
    tx.objectStore('privateMessages').put({ id: 'm2', name: 't4_m2', first_message_name: 't4_m1', author: 'b', created_utc: 2 });
    await new Promise((res) => { tx.oncomplete = res; });
    legacy.close();
    dloUserCfg('olduser').pmInboxInitialized = true;
    dlo_cfg_save();
    const count = await dlo.db.countObjectsInStore.call({ username: 'olduser' }, 'privateMessages');
    const names = (await indexedDB.databases()).map((d) => d.name);
    // And the settings key, as an install that never ran 2.0 would have it
    const current = dloStorage.get(USER_CONFIG_KEY);
    await dloStorage.set('YAIR_USER_CONFIG', current);
    await dloStorage.set(USER_CONFIG_KEY, undefined);
    const moved = await dloStorage.migrateLegacyConfig();
    const stored = await chrome.storage.local.get(['YAIR_USER_CONFIG', 'DLO_USER_CONFIG']);
    return {
      count, initialized: dloUserCfg('olduser').pmInboxInitialized,
      legacyGone: !names.includes('YAIR_Messagesolduser'), renamed: names.includes('DLO_Messagesolduser'),
      moved, oldKeyGone: !('YAIR_USER_CONFIG' in stored), kept: !!(stored.DLO_USER_CONFIG && stored.DLO_USER_CONFIG.testuser),
    };
  });
  check('upgrade: messages move from the YAIR-era database, which is then removed', migrated.count === 2 && migrated.renamed && migrated.legacyGone, migrated);
  check('upgrade: an already-indexed account stays indexed after the move', migrated.initialized === true, migrated);
  check('upgrade: settings move from YAIR_USER_CONFIG to DLO_USER_CONFIG', migrated.moved && migrated.oldKeyGone && migrated.kept, migrated);

  // 12. Toolbar popup
  const notif = await sw.evaluate(() => dloNotifications.update().then(d => d.data.children.length));
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('badge counts unread private messages only', badge === '1', { badge, children: notif });
  const alarms = await sw.evaluate(() => chrome.alarms.getAll());
  check('unread check scheduled every 15 minutes by default', alarms.some(a => a.name === 'dlo-refresh-notifications' && a.periodInMinutes === 15), alarms);
  let popup = await ctx.newPage();
  popup.on('pageerror', e => errors.push('[popup] ' + e.message));
  await popup.goto(`chrome-extension://${extId}/template/notifications_panel.html`);
  await popup.waitForSelector('.notification');
  check('popup lists the unread PM', await popup.locator('.notification').count() === 1);
  check('popup shows subject as text, not HTML', (await popup.locator('.subjectLine').innerText()).includes('<img') && await popup.locator('#notifications img').count() === 0);
  check('popup header shows the unread count', (await popup.locator('#unreadStatus').innerText()) === '1 unread message');
  check('popup is branded Dead Letter Office', (await popup.locator('.wordmark').innerText()).includes('Dead Letter Office') && (await popup.title()) === 'Dead Letter Office');
  const dloTabs = () => ctx.pages().filter(pg => !pg.isClosed() && /\/message\/dlo_/.test(pg.url())).length;
  const tabsBefore = dloTabs();
  const hasOpenInbox = await popup.locator('#openInbox').isVisible();
  await popup.click('#openInbox').catch(() => {});
  await new Promise(r => setTimeout(r, 800));
  check('Open inbox switches to the existing archive tab instead of opening another', hasOpenInbox && dloTabs() === tabsBefore, { before: tabsBefore, after: dloTabs() });
  if (popup.isClosed()) {
    popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/template/notifications_panel.html`);
    await popup.waitForSelector('.notification');
  }
  await popup.screenshot({ path: path.join(DIR, 'popup.png') });
  const [newTab] = await Promise.all([ctx.waitForEvent('page'), popup.click('.notification')]);
  await newTab.waitForSelector('.dlo-conversation', { timeout: 15000 });
  check('clicking a notification opens it in the archive', newTab.url().endsWith('/message/dlo_conversation/t4_b1'), newTab.url());
  log = await mockLog(newTab);
  check('popup click marked it read on www.reddit.com', log.some(e => e.path === '/api/read_message' && e.host === 'www.reddit.com' && e.body.id === 't4_b1'));
  const badge2 = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('badge cleared after reading', badge2 === '', badge2);
  await newTab.screenshot({ path: path.join(DIR, 'conversation.png') });
  await page.bringToFront();
  await page.screenshot({ path: path.join(DIR, 'inbox.png') });

  // 12a. Unread checks can be turned off
  await page.goto('https://old.reddit.com/message/dlo_inbox');
  await page.waitForSelector('.dlo-message-row');
  await page.click('#DLOShowConfig');
  await page.selectOption('#DLORefreshInterval', '0');
  await page.click('.dlo-save-button');
  await page.waitForTimeout(800);
  const alarmsOff = await sw.evaluate(() => chrome.alarms.getAll());
  check('"Off" stops background unread checks', !alarmsOff.some(a => a.name === 'dlo-refresh-notifications'), alarmsOff);
  await page.click('#DLOShowConfig');
  await page.selectOption('#DLORefreshInterval', '900000');
  await page.click('.dlo-save-button');
  await page.waitForTimeout(500);

  // 12b. Theme can follow the system setting
  await page.goto('https://old.reddit.com/message/dlo_inbox');
  await page.waitForSelector('.dlo-message-row');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('#DLOShowConfig');
  await page.selectOption('#DLONightMode', 'auto');
  await page.click('.dlo-save-button');
  await page.waitForTimeout(600);
  check('"Match system" theme turns dark with a dark OS theme', await page.evaluate(() => document.body.classList.contains('dlo-nightmode')));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  check('...and follows it back to light', !(await page.evaluate(() => document.body.classList.contains('dlo-nightmode'))));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(DIR, 'inbox-dark.png') });
  await page.click('.dlo-message-row:has-text("Project")');
  await page.waitForSelector('.dlo-conversation');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, 'conversation-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // 13. Service worker restart: background calls still work without a fresh "init"
  await page.goto('https://old.reddit.com/message/dlo_inbox');
  await page.waitForSelector('.dlo-message-row');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('ServiceWorker.enable').catch(() => {});
  const swTargets = await cdp.send('Target.getTargets').then(r => r.targetInfos.filter(t => t.type === 'service_worker'));
  for (const t of swTargets) {
    await cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  await page.click('.dlo-message-row:has-text("Filler thread 3")');
  await page.waitForSelector('.dlo-conversation', { timeout: 15000 }).catch(() => {});
  check('works after the service worker is stopped and restarted', await page.locator('.dlo-private-message').count() === 1, swTargets.length);
  // Stop it again with a call in flight: the page should retry quietly, not show an error
  const swNow = await cdp.send('Target.getTargets').then(r => r.targetInfos.filter(t => t.type === 'service_worker'));
  await page.evaluate(() => { document.querySelector('.dlo-save-toggle').click(); });
  for (const t of swNow) await cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  await page.click('.dlo-sidebar-nav.inbox .dlo-saved');
  await page.waitForTimeout(2500);
  const noticeText = await page.locator('.dlo-overlay .notification-message').innerText().catch(() => '');
  check('a stopped background worker is retried without an error message', !/went wrong|couldn't finish/i.test(noticeText) && await page.locator('.dlo-message-row').count() >= 1, noticeText);

  const real = errors.filter(e => !/redditstatic\.com|favicon\.ico/.test(e));
  check('no script errors (ignoring blocked reddit CDN assets)', real.length === 0, real);
  await ctx.close();

  // 14. Current Reddit: messages.json is empty, history only on the new-Reddit archive page
  await (async () => {
    const a = await launch(path.join(DIR, 'profile-archive'));
    const p = await a.ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('https://old.reddit.com/__source?s=archive');
    await p.goto('https://old.reddit.com/__longthread');
    const before = (await mockLog(p)).length;
    await p.goto('https://old.reddit.com/message/dlo_inbox');
    await p.waitForSelector('.dlo-message-row', { timeout: 20000 });
    await p.waitForTimeout(800);
    const rowsA = await p.locator('.dlo-message-row').count();
    check('archive: all 13 conversations indexed from the archive page', rowsA === 13, rowsA);
    let alog = (await mockLog(p)).slice(before);
    const archiveCalls = alog.filter(e => e.host.startsWith('www.') && (e.path === '/message/messages/' || e.path.startsWith('/svc/shreddit/pm-archive/')));
    check('archive: followed the infinite-scroll pages', archiveCalls.length === 4, archiveCalls.map(e => e.path + e.query));
    await p.click('.dlo-message-row:has-text("Filler thread 3")');
    await p.waitForSelector('.dlo-private-message');
    const longCount = await p.locator('.dlo-private-message').count();
    check('archive: long threads are read in full from their own page, not the 3-message preview', longCount === 11, longCount);
    const threadCalls = (await mockLog(p)).slice(before).filter(e => e.host.startsWith('www.') && /^\/message\/messages\/[a-z0-9]+\/$/.test(e.path));
    check('archive: each conversation page fetched once on the first index', threadCalls.length === 13, threadCalls.length);
    const chunkCalls = (await mockLog(p)).slice(before).filter(e => e.path.startsWith('/svc/shreddit/pm-archive-message-replies/'));
    check('archive: older messages of long threads loaded through their "load more" chunks', chunkCalls.length >= 2, chunkCalls.length);
    await p.click('.dlo-sidebar-nav.inbox .dlo-inbox');
    await p.waitForTimeout(400);
    check('archive: subreddit sender shown as #modsub', (await p.locator('.dlo-correspondent a', { hasText: '#modsub' }).getAttribute('href')) === 'https://www.reddit.com/r/modsub');
    await p.click('.dlo-message-row:has-text("Hello there")');
    await p.waitForSelector('.dlo-private-message');
    await p.waitForTimeout(500);
    const bodies = await p.locator('.dlo-pm-body').allInnerTexts();
    check('archive: conversation messages and bodies parsed', bodies.length >= 2 && bodies.some(b => b.includes('Line two')), bodies.map(b => b.slice(0, 40)));
    const authors = await p.locator('.dlo-pm-header h4').allInnerTexts();
    check('archive: authors parsed from profile links', authors.includes('alice') && authors.includes('testuser'), authors);
    const unsafe = await p.evaluate(() => ({
      handlers: document.querySelectorAll('.dlo-pm-body [onclick]').length,
      jsLinks: [...document.querySelectorAll('.dlo-pm-body a')].filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length,
      goodLinks: [...document.querySelectorAll('.dlo-pm-body a[href="https://example.com/x"]')].length,
      xss: window.__xss,
    }));
    check('archive: message HTML sanitized (no handlers or javascript: links)', unsafe.handlers === 0 && unsafe.jsLinks === 0 && unsafe.goodLinks > 0 && unsafe.xss === undefined, unsafe);
    const title = await p.locator('.dlo-message-date-string').first().getAttribute('title');
    check('archive: timestamps parsed', /20\d\d/.test(title || ''), title);
    await p.click('.dlo-sidebar-nav.inbox .dlo-inbox');
    await p.waitForTimeout(400);
    await p.fill('#DLOSearchInput', 'message:magicword');
    await p.press('#DLOSearchInput', 'Enter');
    await p.waitForTimeout(500);
    check('archive: search over archived bodies works', await p.locator('.dlo-message-row').count() === 1);
    const b2 = (await mockLog(p)).length;
    await p.goto('https://old.reddit.com/message/dlo_inbox');
    await p.waitForSelector('.dlo-message-row');
    await p.waitForTimeout(800);
    alog = (await mockLog(p)).slice(b2).filter(e => e.host.startsWith('www.') && (e.path === '/message/messages/' || e.path.startsWith('/svc/shreddit/pm-archive/')));
    check('archive: reload with nothing new reads one archive page and no conversation pages', alog.length === 1, alog.map(e => e.path + e.query));
    const rethreads = (await mockLog(p)).slice(b2).filter(e => e.host.startsWith('www.') && /^\/message\/messages\/[a-z0-9]+\/$/.test(e.path));
    check('archive: unchanged conversations are not re-read', rethreads.length === 0, rethreads.map(e => e.path));
    check('archive: no script errors', errs.length === 0, errs);
    // With no archive tab open, the popup's Open inbox button opens one
    await p.close();
    const pop = await a.ctx.newPage();
    await pop.goto(`chrome-extension://${a.extId}/template/notifications_panel.html`);
    const [opened] = await Promise.all([a.ctx.waitForEvent('page'), pop.click('#openInbox')]);
    await opened.waitForLoadState();
    check('Open inbox opens the archive when no archive tab exists', opened.url() === 'https://old.reddit.com/message/dlo_inbox', opened.url());
    await opened.waitForSelector('.dlo-message-row', { timeout: 15000 }).catch(() => {});
    await opened.goto('https://old.reddit.com/__source?s=json');
    await a.ctx.close();
  })();

  // 16. Restore a backup into a fresh profile; detect a changed archive layout
  await (async () => {
    const r = await launch(path.join(DIR, 'profile-restore'));
    const p = await r.ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('https://old.reddit.com/__source?s=none');
    await p.goto('https://old.reddit.com/message/dlo_inbox');
    await p.waitForSelector('.dlo-empty-state', { timeout: 20000 });
    check('restore: fresh profile with nothing on Reddit starts empty', await p.locator('.dlo-message-row').count() === 0);
    const restoreFrom = async (file) => {
      await p.click('#DLOShowConfig');
      await p.click('.dlo-config-tab[data-tab="admin"]');
      await p.setInputFiles('#DLORestoreFile', file);
      await p.waitForSelector('.dlo-alert', { timeout: 20000 });
      const text = await p.locator('.dlo-alert').innerText();
      await p.click('.dlo-alert button.dlo-alert-close');
      await p.waitForTimeout(700);
      return text;
    };
    const wrong = path.join(DIR, 'backup-other.json');
    fs.writeFileSync(wrong, JSON.stringify(Object.assign({}, exp, { username: 'someoneelse' })));
    const wrongText = await restoreFrom(wrong);
    check("restore: another account's backup is refused", /belongs to u\/someoneelse/.test(wrongText) && await p.locator('.dlo-message-row').count() === 0, wrongText);
    const okText = await restoreFrom(BACKUP);
    check('restore: backup restored with a summary', /Added \d+ messages from 13 conversations/.test(okText), okText);
    await p.waitForSelector('.dlo-message-row');
    check('restore: conversations back in the inbox (archived one excluded)', await p.locator('.dlo-message-row').count() === 12);
    await p.click('.dlo-sidebar-nav.inbox .dlo-archived');
    await p.waitForTimeout(500);
    check('restore: archived flag restored', await p.locator('.dlo-message-row:has-text("Hello there")').count() === 1);
    await p.click('.dlo-sidebar-nav.inbox .dlo-inbox');
    await p.waitForTimeout(400);
    const again = await restoreFrom(BACKUP);
    check('restore: restoring twice adds nothing', /Added 0 messages/.test(again) && /were already here/.test(again), again);

    // Reddit changes its markup: say so instead of quietly finding nothing
    await p.goto('https://old.reddit.com/__source?s=changed');
    await p.goto('https://old.reddit.com/message/dlo_inbox');
    await p.waitForSelector('.dlo-message-row');
    await p.click('#DLOShowConfig');
    await p.click('.dlo-config-tab[data-tab="admin"]');
    await p.click('#DLOReindexMessages');
    await p.waitForSelector('.dlo-banner', { timeout: 20000 });
    const notice = await p.locator('.dlo-banner').innerText();
    check('layout change: reindex reports that Reddit changed its page', /has changed/.test(notice) && /stored messages are safe/.test(notice), notice);
    await p.goto('https://old.reddit.com/message/dlo_inbox');
    await p.waitForSelector('.dlo-banner', { timeout: 20000 });
    await p.waitForSelector('.dlo-message-row');
    await p.waitForTimeout(300);
    check('layout change: on page load the stored inbox still shows, under the warning', await p.locator('.dlo-message-row').count() === 12 && await p.locator('.dlo-overlay.show').count() === 0);
    await p.click('.dlo-banner-close');
    check('layout change: the warning can be dismissed', await p.locator('.dlo-banner').count() === 0);
    await p.click('#DLOShowConfig');
    await p.click('.dlo-config-tab[data-tab="admin"]');
    const [diag] = await Promise.all([p.waitForEvent('download'), p.click('#DLODiagnosticsButton')]);
    const diagText = fs.readFileSync(await diag.path(), 'utf8');
    const report = JSON.parse(diagText);
    check('diagnostics: records the failed run and the page structure', /^failed/.test(report.lastIndexRun.outcome) && report.stored.conversations === 13 && report.lastIndexRun.warnings.length >= 1, report.lastIndexRun);
    check('diagnostics: contain no message text, subjects, or usernames', !/magicword|Hello there|alice|filler|testuser/i.test(diagText), diagText.slice(0, 300));
    check('restore/diagnostics: no script errors', errs.length === 0, errs);
    await p.goto('https://old.reddit.com/__source?s=json');
    await r.ctx.close();
  })();

  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
