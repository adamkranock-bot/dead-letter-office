// End-to-end test: loads the unpacked extension in Chromium and drives it
// against a mock Reddit. Run with `npm run test:e2e` (needs openssl on PATH).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMockReddit } = require('./mock-reddit');

const EXT = path.resolve(__dirname, '..', '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yair-e2e-'));
const PROFILE = path.join(DIR, 'profile');
let PORT = 0;
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''));
}
async function openReplyBox(page) {
  // Replies sit behind the read-only archive notice
  if (await page.locator('.yair-reply-anyway').count()) await page.click('.yair-reply-anyway');
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
  await page.goto('https://old.reddit.com/message/yair_inbox');
  await page.waitForSelector('.yair-message-row', { timeout: 20000 });
  await page.waitForTimeout(800);
  let rows = await page.locator('.yair-message-row').count();
  check('full index renders all 13 conversations', rows === 13, rows);
  let log = await mockLog(page);
  const listingCalls = () => log.filter(e => e.path === '/message/messages.json');
  check('full index walked all 3 pages', listingCalls().length === 3, listingCalls().map(e => e.query));
  check('unread conversation is highlighted', await page.locator('.yair-message-row.yair-unread').count() === 1);
  check('subreddit correspondent links to /r/', (await page.locator('.yair-correspondent a', { hasText: '#modsub' }).getAttribute('href')) === 'https://www.reddit.com/r/modsub');
  check('no script injection via subject', await page.evaluate(() => window.__xss) === undefined);
  check('bulk "Mark Selected Read" is bound to mark read', await page.locator('#YAIRBulkMarkRead').innerText().then(t => t.includes('Mark Selected Read')));

  // 2. Search with message: prefix (used to throw)
  await page.fill('#YAIRSearchInput', 'message:magicword');
  await page.press('#YAIRSearchInput', 'Enter');
  await page.waitForTimeout(600);
  rows = await page.locator('.yair-message-row').count();
  check('search "message:magicword" finds 1 conversation', rows === 1, rows);
  await page.fill('#YAIRSearchInput', 'subject:Project &');
  await page.press('#YAIRSearchInput', 'Enter');
  await page.waitForTimeout(600);
  rows = await page.locator('.yair-message-row').count();
  check('search with "&" survives the URL round trip', rows === 1, { rows, url: page.url() });
  await page.click('.yair-sidebar-nav.inbox .yair-inbox');
  await page.waitForTimeout(600);

  // 2b. Archive-viewer UI
  const summary = await page.locator('.yair-summary').innerText();
  check('summary line shows counts and date range', /13 conversations, 14 messages from Oct 2025/.test(summary), summary);
  await page.fill('#YAIRSearchInput', 'filler');
  await page.waitForTimeout(900);
  rows = await page.locator('.yair-message-row').count();
  check('search updates as you type (no Enter)', rows === 10, rows);
  check('matches are highlighted', await page.locator('.yair-inbox-panel mark').count() >= 10);
  check('summary shows match count while searching', (await page.locator('.yair-summary').innerText()).includes('10 of 13 conversations match'));
  await page.click('#YAIRSearchClear');
  await page.waitForTimeout(700);
  check('clear button restores the full list', await page.locator('.yair-message-row').count() === 13 && !page.url().includes('search='));
  check('message count badge on multi-message conversations', (await page.locator('.yair-message-row:has-text("Hello there") .yair-message-count').innerText()) === '2');
  await page.locator('body').click({ position: { x: 600, y: 5 } }).catch(() => {});
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  check('j/k moves keyboard focus', await page.locator('.yair-message-row.yair-row-focused').count() === 1);
  const focusedSubject = await page.locator('.yair-row-focused .yair-subject').innerText();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.yair-conversation');
  check('Enter opens the focused conversation', (await page.locator('.yair-conversation-title').innerText()) === focusedSubject, focusedSubject);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.yair-message-row');
  check('Esc returns to the list', page.url().endsWith('/message/yair_inbox'));
  await page.screenshot({ path: path.join(DIR, 'inbox-light.png') });

  // 2c. Sort and filter by thread length, year, and who wrote last
  const rowCount = () => page.locator('.yair-message-row').count();
  await page.selectOption('#YAIRSort', 'most');
  await page.waitForTimeout(400);
  check('sort by most messages puts the longest thread first', (await page.locator('.yair-message-row .yair-subject').first().innerText()) === 'Hello there');
  check('length sort groups by thread size', (await page.locator('.yair-year-divider').first().innerText()) === '2 to 4 messages', await page.locator('.yair-year-divider').allInnerTexts());
  await page.selectOption('#YAIRSort', 'fewest');
  await page.waitForTimeout(400);
  check('sort by fewest messages puts it last', (await page.locator('.yair-message-row .yair-subject').last().innerText()) === 'Hello there');
  await page.click('.yair-length-preset:text-is("2+")');
  await page.waitForTimeout(400);
  check('"2+" preset keeps only multi-message threads', await rowCount() === 1 && (await page.locator('.yair-summary').innerText()).includes('1 of 13 conversations match'));
  await page.click('.yair-length-preset:text-is("1")');
  await page.waitForTimeout(400);
  check('"1" preset keeps only single-message threads', await rowCount() === 12);
  await page.click('.yair-length-preset:text-is("Any")');
  await page.fill('#YAIRMinMessages', '2');
  await page.fill('#YAIRMaxMessages', '3');
  await page.waitForTimeout(700);
  check('min/max message range filters', await rowCount() === 1);
  await page.fill('#YAIRMinMessages', '3');
  await page.waitForTimeout(700);
  check('range with no matches shows a hint', await rowCount() === 0 && (await page.locator('.yair-empty-state').innerText()).includes('widening'));
  await page.click('.yair-summary-clear:text-is("Clear filters")');
  await page.waitForTimeout(400);
  check('Clear filters restores everything and empties the inputs', await rowCount() === 13 && (await page.inputValue('#YAIRMinMessages')) === '');
  await page.selectOption('#YAIRLastFrom', 'me');
  await page.waitForTimeout(400);
  check('"last message from me" filter', await rowCount() === 1);
  await page.selectOption('#YAIRLastFrom', 'them');
  await page.waitForTimeout(400);
  check('"last message from them" filter', await rowCount() === 12);
  await page.selectOption('#YAIRLastFrom', '');
  const years = await page.locator('#YAIRYear option').allInnerTexts();
  await page.selectOption('#YAIRYear', '2025');
  await page.waitForTimeout(400);
  check('year filter lists the years present and filters by them', years.includes('2025') && await rowCount() === 13, years);
  await page.selectOption('#YAIRYear', '');
  await page.selectOption('#YAIRSort', 'az');
  await page.waitForTimeout(400);
  const names = await page.locator('.yair-correspondent a.author').allInnerTexts();
  check('A to Z sort orders by name', names[0] === 'alice' && names[names.length - 1] === '#modsub', names);
  await page.selectOption('#YAIRSort', 'most');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('.yair-message-row');
  check('chosen sort is remembered after a reload', (await page.inputValue('#YAIRSort')) === 'most');
  await page.selectOption('#YAIRSort', 'newest');
  await page.waitForTimeout(400);

  // 3. Open a conversation
  await page.click('.yair-message-row:has-text("Hello there")');
  await page.waitForSelector('.yair-conversation');
  await page.waitForTimeout(800);
  check('conversation shows both messages', await page.locator('.yair-private-message').count() === 2);
  log = await mockLog(page);
  const readCalls = log.filter(e => e.path === '/api/read_message' && e.body.id.includes('t4_a1'));
  check('read_message sent once, batched, only for received messages', readCalls.length === 1 && readCalls[0].body.id === 't4_a1', readCalls.map(e => e.body));
  const title = await page.locator('.yair-message-date-string').first().getAttribute('title');
  check('date tooltip rendered without moment.js', !!title && /20\d\d/.test(title), title);

  // 4. Clicking the sidebar "Archived" icon from a conversation must not archive it
  await page.click('.yair-sidebar-nav.inbox .yair-archived .icon-archive');
  await page.waitForTimeout(800);
  rows = await page.locator('.yair-message-row').count();
  check('sidebar archive icon does not archive the open conversation', rows === 0 && page.url().endsWith('yair_archived'), { rows, url: page.url() });

  // 5. Reply
  await page.click('.yair-sidebar-nav.inbox .yair-inbox');
  await page.waitForTimeout(500);
  await page.click('.yair-message-row:has-text("Hello there")');
  await page.waitForSelector('.yair-conversation');
  check('archive notice shown instead of the reply box', await page.locator('.yair-archive-notice').isVisible() && !(await page.locator('.yair-message-editor').isVisible()));
  await openReplyBox(page);
  await page.click('.yair-switch-editor');
  await page.fill('#markdown', 'Thanks!\n\nSecond paragraph');
  await page.locator('#markdown').dispatchEvent('keyup');
  const before = listingCalls().length;
  await page.click('.yair-conversation-reply-btn');
  await page.waitForFunction(() => document.querySelectorAll('.yair-private-message').length === 3, null, { timeout: 15000 }).catch(() => {});
  check('reply sent and conversation refreshed with 3 messages', await page.locator('.yair-private-message').count() === 3);
  log = await mockLog(page);
  const comment = log.filter(e => e.path === '/api/comment').pop();
  check('reply posted to the latest received message with modhash', comment && comment.body.thing_id === 't4_a1' && comment.body.uh === 'modhash123' && comment.body.text.includes('Second paragraph'), comment && comment.body);
  const incr = listingCalls().slice(before);
  check('incremental index stops at first page with nothing new', incr.length === 2, incr.map(e => e.query));

  // 6. Reply rejected by Reddit (PMs moving to chat)
  await page.evaluate(() => fetch('https://old.reddit.com/__replyMode?m=error'));
  await openReplyBox(page);
  await page.click('.yair-switch-editor');
  await page.fill('#markdown', 'This will fail');
  await page.locator('#markdown').dispatchEvent('keyup');
  await page.click('.yair-conversation-reply-btn');
  await page.waitForSelector('.yair-alert-error', { timeout: 5000 }).catch(() => {});
  const alertText = await page.locator('.yair-alert-error').innerText().catch(() => '');
  check("Reddit's own error message is shown", alertText.includes('only accepting messages through chat'), alertText);
  await page.click('.yair-alert-error button.yair-alert-ok');
  await page.waitForTimeout(800);
  await page.evaluate(() => fetch('https://old.reddit.com/__replyMode?m=ok'));
  const draft = await sw.evaluate(() => chrome.storage.local.get('YAIR_DRAFTS'));
  check('failed reply keeps the draft', JSON.stringify(draft).includes('This will fail'), draft);

  // 7. Export one conversation
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#YairExportConversation')]);
  let text = fs.readFileSync(await dl.path(), 'utf8');
  check('conversation export has every line break converted', text.includes('Line one\r\nLine two\r\nLine three'), text.slice(0, 200));
  check('export filename is filesystem safe', /^Hello there_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.txt$/.test(dl.suggestedFilename()), dl.suggestedFilename());

  // 8. Archive from the conversation header
  await page.click('.conversation-header-right .icon-archive');
  await page.waitForTimeout(1200);
  rows = await page.locator('.yair-message-row').count();
  check('archiving from conversation returns to inbox without it', rows === 12 && page.url().endsWith('yair_inbox'), { rows, url: page.url() });
  await page.click('.yair-sidebar-nav.inbox .yair-archived');
  await page.waitForTimeout(600);
  check('archived folder lists it', await page.locator('.yair-message-row').count() === 1);
  await page.click('.yair-sidebar-nav.inbox .yair-inbox');
  await page.waitForTimeout(600);

  // 9. Export everything as JSON from settings
  await page.click('#YAIRShowConfig');
  await page.click('.yair-config-tab[data-tab="admin"]');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('.yair-export-all[data-format="json"]')]);
  const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const hello = exp.conversations.find(c => c.subject === 'Hello there');
  check('export-all JSON has every conversation with flags', exp.conversations.length === 13 && hello.archived === true && hello.messages.length === 3, { n: exp.conversations.length, archived: hello && hello.archived });
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await page.waitForTimeout(800);

  // 10. Reload: nothing new -> one listing request
  const beforeReload = (await mockLog(page)).filter(e => e.path === '/message/messages.json').length;
  await page.reload();
  await page.waitForSelector('.yair-message-row');
  await page.waitForTimeout(800);
  const afterReload = (await mockLog(page)).filter(e => e.path === '/message/messages.json').length;
  check('reload with nothing new fetches a single page', afterReload - beforeReload === 1, afterReload - beforeReload);

  // 11. Settings survive (stored in chrome.storage via the service worker)
  const cfg = await sw.evaluate(() => chrome.storage.local.get('YAIR_USER_CONFIG'));
  check('archived id persisted in chrome.storage', cfg.YAIR_USER_CONFIG.testuser.deleted.includes('t4_a1'), cfg.YAIR_USER_CONFIG.testuser.deleted);

  // 12. Toolbar popup
  const notif = await sw.evaluate(() => yairNotifications.update().then(d => d.data.children.length));
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('badge counts unread private messages only', badge === '1', { badge, children: notif });
  const alarms = await sw.evaluate(() => chrome.alarms.getAll());
  check('refresh scheduled with chrome.alarms', alarms.some(a => a.name === 'yair-refresh-notifications' && a.periodInMinutes === 1), alarms);
  let popup = await ctx.newPage();
  popup.on('pageerror', e => errors.push('[popup] ' + e.message));
  await popup.goto(`chrome-extension://${extId}/template/notifications_panel.html`);
  await popup.waitForSelector('.notification');
  check('popup lists the unread PM', await popup.locator('.notification').count() === 1);
  check('popup shows subject as text, not HTML', (await popup.locator('.subjectLine').innerText()).includes('<img') && await popup.locator('#notifications img').count() === 0);
  check('popup header shows the unread count', (await popup.locator('#unreadStatus').innerText()) === '1 unread message');
  const yairTabs = () => ctx.pages().filter(pg => !pg.isClosed() && /\/message\/yair_/.test(pg.url())).length;
  const tabsBefore = yairTabs();
  const hasOpenInbox = await popup.locator('#openInbox').isVisible();
  await popup.click('#openInbox').catch(() => {});
  await new Promise(r => setTimeout(r, 800));
  check('Open inbox switches to the existing YAIR tab instead of opening another', hasOpenInbox && yairTabs() === tabsBefore, { before: tabsBefore, after: yairTabs() });
  if (popup.isClosed()) {
    popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/template/notifications_panel.html`);
    await popup.waitForSelector('.notification');
  }
  await popup.screenshot({ path: path.join(DIR, 'popup.png') });
  const [newTab] = await Promise.all([ctx.waitForEvent('page'), popup.click('.notification')]);
  await newTab.waitForSelector('.yair-conversation', { timeout: 15000 });
  check('clicking a notification opens it in YAIR', newTab.url().endsWith('/message/yair_conversation/t4_b1'), newTab.url());
  log = await mockLog(newTab);
  check('popup click marked it read on www.reddit.com', log.some(e => e.path === '/api/read_message' && e.host === 'www.reddit.com' && e.body.id === 't4_b1'));
  const badge2 = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('badge cleared after reading', badge2 === '', badge2);
  await newTab.screenshot({ path: path.join(DIR, 'conversation.png') });
  await page.bringToFront();
  await page.screenshot({ path: path.join(DIR, 'inbox.png') });

  // 12b. Theme can follow the system setting
  await page.goto('https://old.reddit.com/message/yair_inbox');
  await page.waitForSelector('.yair-message-row');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('#YAIRShowConfig');
  await page.selectOption('#YairNightMode', 'auto');
  await page.click('.yair-save-button');
  await page.waitForTimeout(600);
  check('"Match system" theme turns dark with a dark OS theme', await page.evaluate(() => document.body.classList.contains('yair-nightmode')));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  check('...and follows it back to light', !(await page.evaluate(() => document.body.classList.contains('yair-nightmode'))));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(DIR, 'inbox-dark.png') });
  await page.click('.yair-message-row:has-text("Project")');
  await page.waitForSelector('.yair-conversation');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, 'conversation-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // 13. Service worker restart: background calls still work without a fresh "init"
  await page.goto('https://old.reddit.com/message/yair_inbox');
  await page.waitForSelector('.yair-message-row');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('ServiceWorker.enable').catch(() => {});
  const swTargets = await cdp.send('Target.getTargets').then(r => r.targetInfos.filter(t => t.type === 'service_worker'));
  for (const t of swTargets) {
    await cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  await page.click('.yair-message-row:has-text("Filler thread 3")');
  await page.waitForSelector('.yair-conversation', { timeout: 15000 }).catch(() => {});
  check('works after the service worker is stopped and restarted', await page.locator('.yair-private-message').count() === 1, swTargets.length);

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
    const before = (await mockLog(p)).length;
    await p.goto('https://old.reddit.com/message/yair_inbox');
    await p.waitForSelector('.yair-message-row', { timeout: 20000 });
    await p.waitForTimeout(800);
    const rowsA = await p.locator('.yair-message-row').count();
    check('archive: all 13 conversations indexed from the archive page', rowsA === 13, rowsA);
    let alog = (await mockLog(p)).slice(before);
    const archiveCalls = alog.filter(e => e.host.startsWith('www.') && (e.path === '/message/messages/' || e.path.startsWith('/svc/shreddit/')));
    check('archive: followed the infinite-scroll pages', archiveCalls.length === 4, archiveCalls.map(e => e.path + e.query));
    check('archive: subreddit sender shown as #modsub', (await p.locator('.yair-correspondent a', { hasText: '#modsub' }).getAttribute('href')) === 'https://www.reddit.com/r/modsub');
    await p.click('.yair-message-row:has-text("Hello there")');
    await p.waitForSelector('.yair-private-message');
    await p.waitForTimeout(500);
    const bodies = await p.locator('.yair-pm-body').allInnerTexts();
    check('archive: conversation messages and bodies parsed', bodies.length >= 2 && bodies.some(b => b.includes('Line two')), bodies.map(b => b.slice(0, 40)));
    const authors = await p.locator('.yair-pm-header h4').allInnerTexts();
    check('archive: authors parsed from profile links', authors.includes('alice') && authors.includes('testuser'), authors);
    const unsafe = await p.evaluate(() => ({
      handlers: document.querySelectorAll('.yair-pm-body [onclick]').length,
      jsLinks: [...document.querySelectorAll('.yair-pm-body a')].filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length,
      goodLinks: [...document.querySelectorAll('.yair-pm-body a[href="https://example.com/x"]')].length,
      xss: window.__xss,
    }));
    check('archive: message HTML sanitized (no handlers or javascript: links)', unsafe.handlers === 0 && unsafe.jsLinks === 0 && unsafe.goodLinks > 0 && unsafe.xss === undefined, unsafe);
    const title = await p.locator('.yair-message-date-string').first().getAttribute('title');
    check('archive: timestamps parsed', /20\d\d/.test(title || ''), title);
    await p.click('.yair-sidebar-nav.inbox .yair-inbox');
    await p.waitForTimeout(400);
    await p.fill('#YAIRSearchInput', 'message:magicword');
    await p.press('#YAIRSearchInput', 'Enter');
    await p.waitForTimeout(500);
    check('archive: search over archived bodies works', await p.locator('.yair-message-row').count() === 1);
    const b2 = (await mockLog(p)).length;
    await p.goto('https://old.reddit.com/message/yair_inbox');
    await p.waitForSelector('.yair-message-row');
    await p.waitForTimeout(800);
    alog = (await mockLog(p)).slice(b2).filter(e => e.host.startsWith('www.') && (e.path === '/message/messages/' || e.path.startsWith('/svc/shreddit/')));
    check('archive: reload with nothing new reads one archive page', alog.length === 1, alog.map(e => e.path + e.query));
    check('archive: no script errors', errs.length === 0, errs);
    // With no YAIR tab open, the popup's Open inbox button opens one
    await p.close();
    const pop = await a.ctx.newPage();
    await pop.goto(`chrome-extension://${a.extId}/template/notifications_panel.html`);
    const [opened] = await Promise.all([a.ctx.waitForEvent('page'), pop.click('#openInbox')]);
    await opened.waitForLoadState();
    check('Open inbox opens YAIR when no YAIR tab exists', opened.url() === 'https://old.reddit.com/message/yair_inbox', opened.url());
    await opened.waitForSelector('.yair-message-row', { timeout: 15000 }).catch(() => {});
    await opened.goto('https://old.reddit.com/__source?s=json');
    await a.ctx.close();
  })();

  // 15. MV2 -> MV3 migration: seed old localStorage, clear new storage, restart
  ({ ctx, sw, extId } = await launch());
  const seed = await ctx.newPage();
  await seed.goto(`chrome-extension://${extId}/offscreen/migrate.html`);
  await seed.evaluate(() => {
    localStorage.clear();
    localStorage.YAIR_USER_CONFIG = JSON.stringify({ olduser: { saved: ['t4_x'], deleted: ['t4_y'], pmInboxInitialized: true, compactMode: true } });
    localStorage.YAIR_DRAFTS = JSON.stringify({ olduser: ['t4_x'] });
    localStorage.YAIR_DRAFT_olduser_t4_x = JSON.stringify({ key: 't4_x', timestamp: Date.now(), value: 'my old draft' });
    localStorage.inboxRefreshInterval = '300000';
  });
  await seed.evaluate(() => chrome.storage.local.clear());
  await ctx.close();
  ({ ctx, sw, extId } = await launch());
  await new Promise(r => setTimeout(r, 2000));
  const migrated = await sw.evaluate(() => chrome.storage.local.get(null));
  check('MV2 settings migrated', migrated.YAIR_USER_CONFIG && migrated.YAIR_USER_CONFIG.olduser.saved[0] === 't4_x' && migrated.YAIR_USER_CONFIG.olduser.compactMode === true, migrated.YAIR_USER_CONFIG);
  check('MV2 drafts migrated', migrated.YAIR_DRAFTS && migrated.YAIR_DRAFTS.olduser.t4_x.value === 'my old draft', migrated.YAIR_DRAFTS);
  check('MV2 refresh interval migrated', migrated.inboxRefreshInterval === 300000 && migrated.migratedFromMV2 === true, migrated.inboxRefreshInterval);
  await ctx.close();

  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
