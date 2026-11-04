// Minimal fake of the Reddit endpoints YAIR uses, served over HTTPS.
// The browser is pointed at it with --host-resolver-rules, so the extension
// sees real https://old.reddit.com / www.reddit.com URLs.
const https = require('https');

const ME = 'testuser';
let clock = 1760000000;
const threads = [];
function msg(id, author, dest, subject, body, extra = {}) {
  clock += 3600;
  return Object.assign({
    id, name: 't4_' + id, author, dest, subject, body,
    body_html: '<!-- SC_OFF --><div class="md"><p>' + body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p></div><!-- SC_ON -->',
    created_utc: clock, new: false, distinguished: null, first_message_name: null, subreddit: null,
  }, extra);
}
function thread(root, replies = []) {
  replies.forEach(r => { r.first_message_name = root.name; });
  threads.push({ root, replies });
}
thread(msg('a1', 'alice', ME, 'Hello there', 'Line one\nLine two\nLine three'), [msg('a2', ME, 'alice', 're: Hello there', 'Hi alice!')]);
for (let i = 0; i < 10; i++) thread(msg('f' + i, 'filler' + i, ME, 'Filler thread ' + i, 'filler body ' + i));
thread(msg('m1', null, ME, 'A note from the mods', 'Please read the rules', { subreddit: 'modsub', distinguished: 'moderator' }));
thread(msg('b1', 'bob', ME, 'Project & <stuff> <img src=x onerror="window.__xss=1">', 'the magicword is here', { new: true }));

function latest(t) { return Math.max(t.root.created_utc, ...t.replies.map(r => r.created_utc)); }
function listing() { return threads.slice().sort((a, b) => latest(b) - latest(a)); }

const PAGE = 5;
const log = [];
function json(res, obj, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(new URLSearchParams(b))); });
}
const page = (title) => `<!DOCTYPE html><html><head><title>${title}</title></head><body>
<div id="header"><div id="header-bottom-right"><span class="user"><a href="/user/${ME}/">${ME}</a></span>
<span class="separator">|</span><a id="mail" class="nohavemail" href="/message/inbox/">messages</a>
<a class="message-count" href="/message/unread/">1</a></div></div>
<form><input type="hidden" name="uh" value="modhash123"></form>
<div class="content" role="main"></div></body></html>`;

let replyMode = 'ok';
// 'json': PM history via messages.json (pre-2025 Reddit)
// 'archive': messages.json is empty and history lives on www.reddit.com/message/messages/ (current Reddit)
let source = 'json';
const ARCHIVE_PAGE = 4;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const who = n => n && n.charAt(0) === '#' ? `/r/${n.slice(1)}/` : `/user/${n}/`;
// Mirrors the markup captured from the real archive page (Nov 2026)
function archiveConversation(t) {
  const permalink = '/message/messages/' + t.root.id;
  const msgs = [t.root, ...t.replies].map(m => {
    const author = m.author || '#' + m.subreddit;
    const iso = new Date(m.created_utc * 1000).toISOString();
    return `<div class="px-md py-xs " data-test-id="pm-archive-message-template"><div class="text-12 flex items-center justify-between"><div class="text-neutral-content-weak"><span class="font-semibold"><a href="${who(author)}" class="text-12 font-semibold w-fit text-primary-plain">${author.charAt(0) === '#' ? 'r/' + author.slice(1) : 'u/' + author}</a> to <a href="${who(m.dest)}" class="text-12 font-semibold">u/${m.dest}</a></span><span> · </span><faceplate-timeago ts="${iso.replace('Z', '000+0000')}" short=""><time datetime="${iso}" title="x">1y</time></faceplate-timeago></div><faceplate-dropdown-menu><button id="pm-archive-overflow-menu-${m.name}" aria-haspopup="true"><svg viewBox="0 0 20 20"></svg></button><faceplate-menu slot="menu" hidden=""><shreddit-share-list-item permalink="${permalink}"><li>Share</li></shreddit-share-list-item></faceplate-menu></faceplate-dropdown-menu></div><span class="text-14"><div id="-post-rtjson-content" class="[--emote-size:20px]" dir="auto">${m.body.split('\n').map(l => `<p onclick="window.__xss=1">${esc(l)}</p>`).join('')}<p><a href="javascript:window.__xss=1">bad link</a> <a href="https://example.com/x" rel="noopener nofollow ugc" target="_blank">good link</a></p></div></span></div>`;
  }).join('');
  return `<div actioned=""><div data-test-id="pm-archive-conversation" class="flex flex-col"><div class="py-xs px-md flex flex-col"><a class="text-16 font-bold" href="${permalink}">${esc(t.root.subject)}</a><span class="font-semibold"><a href="${who(t.root.author === ME ? t.root.dest : (t.root.author || '#' + t.root.subreddit))}">x</a></span></div><div class="h-px"></div>${msgs}</div></div>`;
}
function archiveChunk(start) {
  const all = listing();
  const slice = all.slice(start, start + ARCHIVE_PAGE);
  const more = start + ARCHIVE_PAGE < all.length
    ? `<infinite-loader><faceplate-partial loading="programmatic" src="/svc/shreddit/message/messages?after=${slice[slice.length - 1].root.name}"></faceplate-partial></infinite-loader>` : '';
  return slice.map(archiveConversation).join('') + more;
}
function createMockReddit({ key, cert }) {
return https.createServer({ key, cert }, async (req, res) => {
  const url = new URL(req.url, 'https://' + req.headers.host);
  const entry = { method: req.method, host: req.headers.host, path: url.pathname, query: url.search };
  log.push(entry);
  if (url.pathname === '/__log') return json(res, log);
  if (url.pathname === '/__replyMode') { replyMode = url.searchParams.get('m'); return json(res, { replyMode }); }
  if (url.pathname === '/__source') { source = url.searchParams.get('s'); return json(res, { source }); }
  if (req.headers.host.startsWith('www.') && url.pathname === '/message/messages/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(source === 'archive'
      ? `<!DOCTYPE html><html><head><title>Reddit - The heart of the internet</title><script>window.__xss=1</script></head><body><shreddit-app><main class="main w-full">${archiveChunk(0)}</main></shreddit-app></body></html>`
      : '<!DOCTYPE html><html><body><main></main></body></html>');
  }
  if (req.headers.host.startsWith('www.') && url.pathname === '/svc/shreddit/message/messages') {
    const all = listing();
    const start = all.findIndex(t => t.root.name === url.searchParams.get('after')) + 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(source === 'archive' ? archiveChunk(start) : '');
  }
  if (url.pathname.startsWith('/message/yair_')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(page('messages: inbox'));
  }
  if (url.pathname === '/message/messages.json') {
    if (source === 'archive') return json(res, { kind: 'Listing', data: { after: null, before: null, children: [], modhash: 'modhash123' } });
    const all = listing();
    let start = 0;
    const after = url.searchParams.get('after');
    if (after) start = all.findIndex(t => t.root.name === after) + 1;
    const slice = all.slice(start, start + PAGE);
    const children = slice.map(t => ({ kind: 't4', data: Object.assign({}, t.root, {
      replies: t.replies.length ? { kind: 'Listing', data: { children: t.replies.map(r => ({ kind: 't4', data: Object.assign({}, r, { replies: '' }) })), after: null, before: null } } : '' }) }));
    const nextAfter = start + PAGE < all.length ? slice[slice.length - 1].root.name : null;
    return json(res, { kind: 'Listing', data: { after: nextAfter, before: null, children, modhash: 'modhash123' } });
  }
  if (url.pathname === '/message/unread.json') {
    const unread = [];
    threads.forEach(t => [t.root, ...t.replies].forEach(m => { if (m.new) unread.push({ kind: 't4', data: Object.assign({}, m, { replies: '' }) }); }));
    unread.push({ kind: 't1', data: { name: 't1_c1', body: 'a comment reply' } });
    return json(res, { kind: 'Listing', data: { after: null, before: null, children: unread, modhash: 'modhash123' } });
  }
  if (url.pathname === '/api/read_message' && req.method === 'POST') {
    const body = await readBody(req);
    entry.body = Object.fromEntries(body);
    body.get('id').split(',').forEach(id => threads.forEach(t => [t.root, ...t.replies].forEach(m => { if (m.name === id) m.new = false; })));
    return json(res, {});
  }
  if (url.pathname === '/api/comment' && req.method === 'POST') {
    const body = await readBody(req);
    entry.body = Object.fromEntries(body);
    if (replyMode === 'error') return json(res, { json: { errors: [['RESTRICTED_TO_PM', 'this user is only accepting messages through chat', 'thing_id']] } });
    if (replyMode === 'http500') return json(res, {}, 500);
    const t = threads.find(t => t.root.name === body.get('thing_id') || t.replies.some(r => r.name === body.get('thing_id')));
    const other = t.root.author === ME ? t.root.dest : t.root.author;
    t.replies.push(Object.assign(msg('r' + Date.now(), ME, other, 're: ' + t.root.subject, body.get('text')), { first_message_name: t.root.name }));
    return json(res, { json: { errors: [], data: { things: [] } } });
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
}
module.exports = { createMockReddit };
