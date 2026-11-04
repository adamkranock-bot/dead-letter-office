// Search for the archive: query parsing, matching, excerpts, and highlighting.
//
// Query language (all case- and accent-insensitive, partial matches):
//   words            every word must appear somewhere in the conversation
//   "exact phrase"   the words together, in order
//   -word, -"phrase" leave out conversations containing it
//   a OR b           either one
//   from:name  to:name  with:name   who wrote / received / took part ("me" works)
//   subject:word  message:word      only that part of the conversation
//   before:2020  after:2019-06  during:2021-03-14   any message in that range
//   messages:>20  messages:5-10     thread length
//   has:link   is:unread  is:saved  is:archived  is:modmail
(function () {
	var DIACRITICS = /[̀-ͯ]/g;

	// Lowercase and strip accents, one output character per input character,
	// so positions found in the folded text map straight back to the original.
	function fold(str) {
		str = String(str || '');
		var out = '';
		for (var i = 0; i < str.length; i++) {
			var c = str.charAt(i);
			var f = c.normalize ? c.normalize('NFD').replace(DIACRITICS, '').toLowerCase() : c.toLowerCase();
			out += f.length === 1 ? f : c.toLowerCase().charAt(0) || c;
		}
		return out;
	}

	// ----- Parsing ---------------------------------------------------------

	var TEXT_FIELDS = {
		from: 'from'
		, author: 'from'
		, to: 'to'
		, with: 'with'
		, subject: 'subject'
		, title: 'subject'
		, message: 'message'
		, body: 'message'
		, text: 'message'
	};

	function dateRange(value) {
		var m = /^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/.exec(value);
		if (!m) return null;
		var y = +m[1], mo = m[2] ? +m[2] - 1 : null, d = m[3] ? +m[3] : null;
		var start, end;
		if (d !== null) {
			start = new Date(y, mo, d);
			end = new Date(y, mo, d + 1);
		}
		else if (mo !== null) {
			start = new Date(y, mo, 1);
			end = new Date(y, mo + 1, 1);
		}
		else {
			start = new Date(y, 0, 1);
			end = new Date(y + 1, 0, 1);
		}
		return {
			start: start.getTime() / 1000
			, end: end.getTime() / 1000
		};
	}

	function countRange(value) {
		var m;
		if ((m = /^(>=|<=|>|<)?(\d+)$/.exec(value))) {
			var n = +m[2];
			switch (m[1]) {
			case '>': return { min: n + 1, max: Infinity };
			case '>=': return { min: n, max: Infinity };
			case '<': return { min: 0, max: n - 1 };
			case '<=': return { min: 0, max: n };
			default: return { min: n, max: n };
			}
		}
		if ((m = /^(\d+)(?:-|\.\.)(\d+)$/.exec(value))) return { min: +m[1], max: +m[2] };
		return null;
	}

	function parse(input, username) {
		input = String(input || '').trim();
		if (!input) return null;
		var me = fold(username || '');
		var items = [];
		var filters = [];
		var pendingOr = false;
		var re = /(-)?(?:([A-Za-z]+):)?(?:"([^"]*)"?|(\S+))/g;
		var m;
		while ((m = re.exec(input))) {
			if (!m[0]) {
				re.lastIndex++;
				continue;
			}
			var negate = !!m[1];
			var op = m[2] ? m[2].toLowerCase() : null;
			var quoted = m[3] !== undefined;
			var value = quoted ? m[3] : m[4];
			if (!op && !negate && !quoted && value === 'OR') {
				pendingOr = items.length > 0;
				continue;
			}
			if (op && value === undefined) {
				// "word:" with nothing after it; search for it literally
				value = '';
			}
			var item = null;
			if (op && TEXT_FIELDS[op]) {
				var v = fold(value);
				if (v === 'me' && /^(from|to|with)$/.test(TEXT_FIELDS[op])) v = me;
				if (v) item = { type: 'text', field: TEXT_FIELDS[op], text: v, negate: negate };
			}
			else if (op === 'before' || op === 'after' || op === 'during' || op === 'in' || op === 'year') {
				var r = dateRange(value);
				if (r) filters.push({ type: 'date', op: op === 'before' ? 'before' : op === 'after' ? 'after' : 'during', range: r, negate: negate });
				else item = { type: 'text', field: 'any', text: fold(m[0].replace(/^-/, '')), negate: negate };
			}
			else if (op === 'messages' || op === 'count' || op === 'replies') {
				var c = countRange(value);
				if (c) filters.push({ type: 'count', range: c, negate: negate });
			}
			else if (op === 'has' || op === 'is') {
				filters.push({ type: 'flag', flag: fold(value), negate: negate });
			}
			else {
				// No operator, or one we don't know: plain text (keeping "word:" as typed)
				var text = fold(op ? m[2] + ':' + (value || '') : value);
				if (text) item = { type: 'text', field: 'any', text: text, negate: negate };
			}
			if (!item) {
				pendingOr = false;
				continue;
			}
			if (pendingOr && !item.negate) {
				var last = items[items.length - 1];
				if (last.type === 'or') last.alts.push(item);
				else if (!last.negate) items[items.length - 1] = { type: 'or', alts: [last, item] };
				else items.push(item);
			}
			else {
				items.push(item);
			}
			pendingOr = false;
		}
		if (!items.length && !filters.length) return null;
		return {
			raw: input
			, items: items
			, filters: filters
		};
	}

	// ----- Matching --------------------------------------------------------

	var prepared = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

	function prep(c) {
		var hit = prepared && prepared.get(c);
		if (hit && hit.n === c.messages.length) return hit;
		var people = [c.correspondent];
		var msgs = c.messages.map(function (m) {
			if (people.indexOf(m.author) < 0) people.push(m.author);
			if (people.indexOf(m.dest) < 0) people.push(m.dest);
			return {
				msg: m
				, body: fold(m.body)
				, author: fold(m.author)
				, dest: fold(m.dest)
				, ts: m.created_utc || 0
				, link: /https?:\/\//i.test(m.body || '') || /<a\s[^>]*href=/i.test(m.body_html || '')
			};
		});
		var p = {
			n: c.messages.length
			, subject: fold(c.subject)
			, correspondent: fold(c.correspondent)
			, people: people.filter(Boolean).map(fold)
			, msgs: msgs
		};
		if (prepared) prepared.set(c, p);
		return p;
	}

	// Returns {ok, matched: [message], textTerms: {...}}
	function evalText(item, p, collect) {
		var t = item.text;
		var ok = false;
		var hits = [];
		switch (item.field) {
		case 'subject':
			ok = p.subject.indexOf(t) >= 0;
			break;
		case 'message':
			p.msgs.forEach(function (m) { if (m.body.indexOf(t) >= 0) hits.push(m.msg); });
			ok = hits.length > 0;
			break;
		case 'from':
			p.msgs.forEach(function (m) { if (m.author.indexOf(t) >= 0) hits.push(m.msg); });
			ok = hits.length > 0 || p.correspondent.indexOf(t) >= 0;
			break;
		case 'to':
			p.msgs.forEach(function (m) { if (m.dest.indexOf(t) >= 0) hits.push(m.msg); });
			ok = hits.length > 0;
			break;
		case 'with':
			ok = p.people.some(function (x) { return x.indexOf(t) >= 0; });
			break;
		default:
			p.msgs.forEach(function (m) { if (m.body.indexOf(t) >= 0) hits.push(m.msg); });
			ok = hits.length > 0 || p.subject.indexOf(t) >= 0 || p.people.some(function (x) { return x.indexOf(t) >= 0; });
		}
		if (item.negate) return !ok;
		if (ok && collect) hits.forEach(function (h) { collect.add(h); });
		return ok;
	}

	function evalFilter(f, p, c, flags) {
		var ok;
		if (f.type === 'date') {
			ok = p.msgs.some(function (m) {
				if (f.op === 'before') return m.ts < f.range.start;
				if (f.op === 'after') return m.ts >= f.range.start;
				return m.ts >= f.range.start && m.ts < f.range.end;
			});
		}
		else if (f.type === 'count') {
			ok = p.n >= f.range.min && p.n <= f.range.max;
		}
		else {
			switch (f.flag) {
			case 'link': case 'links': ok = p.msgs.some(function (m) { return m.link; }); break;
			case 'unread': case 'new': ok = !!c['new']; break;
			case 'read': ok = !c['new']; break;
			case 'saved': case 'starred': ok = flags.saved(c.id); break;
			case 'archived': ok = flags.archived(c.id); break;
			case 'modmail': case 'mod': ok = !!c.modmail; break;
			default: ok = true;
			}
		}
		return f.negate ? !ok : ok;
	}

	function match(c, q, flags) {
		var p = prep(c);
		var collect = typeof Set !== 'undefined' ? new Set() : null;
		for (var i = 0; i < q.items.length; i++) {
			var item = q.items[i];
			var ok = item.type === 'or' ?
				item.alts.map(function (a) { return evalText(a, p, collect); }).some(Boolean) :
				evalText(item, p, collect);
			if (!ok) return { ok: false };
		}
		for (var j = 0; j < q.filters.length; j++) {
			if (!evalFilter(q.filters[j], p, c, flags)) return { ok: false };
		}
		var matched = collect ? Array.from(collect) : [];
		matched.sort(function (a, b) { return (b.created_utc || 0) - (a.created_utc || 0); });
		return { ok: true, matched: matched };
	}

	// Words to highlight in a given part: 'subject', 'people', or 'message'
	function terms(q, part) {
		if (!q) return [];
		var out = [];
		var add = function (item) {
			if (item.type === 'or') return item.alts.forEach(add);
			if (item.negate) return;
			if (item.field === 'any' ||
				(part === 'subject' && item.field === 'subject') ||
				(part === 'message' && item.field === 'message') ||
				(part === 'people' && /^(from|to|with)$/.test(item.field))) {
				if (out.indexOf(item.text) < 0) out.push(item.text);
			}
		};
		q.items.forEach(add);
		return out.sort(function (a, b) { return b.length - a.length; });
	}

	// ----- Highlighting and excerpts ----------------------------------------

	// [start, end) ranges of the terms in `text`, non-overlapping, in order
	function ranges(text, list) {
		var folded = fold(text);
		var found = [];
		list.forEach(function (t) {
			if (!t) return;
			var at = 0;
			while ((at = folded.indexOf(t, at)) >= 0) {
				found.push([at, at + t.length]);
				at += t.length;
			}
		});
		found.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
		var out = [];
		found.forEach(function (r) {
			if (!out.length || r[0] >= out[out.length - 1][1]) out.push(r);
		});
		return out;
	}

	// Wrap matches in <mark> inside an element, touching text nodes only
	function mark(el, list) {
		if (!el || !list.length) return 0;
		var count = 0;
		var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
		var nodes = [];
		while (walker.nextNode()) nodes.push(walker.currentNode);
		nodes.forEach(function (node) {
			if (node.parentNode && node.parentNode.closest && node.parentNode.closest('mark')) return;
			var text = node.textContent;
			var rs = ranges(text, list);
			if (!rs.length) return;
			var frag = document.createDocumentFragment();
			var pos = 0;
			rs.forEach(function (r) {
				if (r[0] > pos) frag.appendChild(document.createTextNode(text.slice(pos, r[0])));
				var m = document.createElement('mark');
				m.textContent = text.slice(r[0], r[1]);
				frag.appendChild(m);
				pos = r[1];
				count++;
			});
			if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
			node.parentNode.replaceChild(frag, node);
		});
		return count;
	}

	// A short window of text around the first match
	function excerpt(text, list, length) {
		text = String(text || '').replace(/\s+/g, ' ').trim();
		length = length || 160;
		var rs = ranges(text, list);
		if (!rs.length || text.length <= length) return text.length > length ? text.slice(0, length) + '…' : text;
		var start = Math.max(0, rs[0][0] - 40);
		// Begin on a word boundary
		if (start > 0) {
			var space = text.lastIndexOf(' ', start);
			start = space > start - 15 ? space + 1 : start;
		}
		var out = text.slice(start, start + length);
		return (start > 0 ? '…' : '') + out + (start + length < text.length ? '…' : '');
	}

	yair.search = {
		fold: fold
		, parse: parse
		, match: match
		, terms: terms
		, mark: mark
		, excerpt: excerpt
	};
})();
