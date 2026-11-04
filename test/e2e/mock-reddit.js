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
function createMockReddit({ key, cert }) {
return https.createServer({ key, cert }, async (req, res) => {
  const url = new URL(req.url, 'https://' + req.headers.host);
  const entry = { method: req.method, host: req.headers.host, path: url.pathname, query: url.search };
  log.push(entry);
  if (url.pathname === '/__log') return json(res, log);
  if (url.pathname === '/__replyMode') { replyMode = url.searchParams.get('m'); return json(res, { replyMode }); }
  if (url.pathname.startsWith('/message/yair_')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(page('messages: inbox'));
  }
  if (url.pathname === '/message/messages.json') {
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
