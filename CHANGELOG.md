# Changelog

## 1.2.0
Packages for every major browser.

* `npm run build` now produces a package per browser from the same source: **Chrome** (and Brave, Opera, Vivaldi), **Microsoft Edge**, **Firefox 140+**, and **Safari**. Each gets its own manifest: a service worker for Chromium; an event page, permanent add-on ID, and "no data collected" declaration for Firefox; an event page for Safari.
* `scripts/safari.sh` wraps the Safari package into an Xcode app with Apple's converter (run on a Mac).
* Replies and mark-as-read requests now go through the extension's background instead of the page, so they work the same in every browser; the old Firefox user-agent check is gone.
* An HTML-decoding helper no longer assigns `innerHTML`.
* CI builds all four packages, lints the Firefox one with Mozilla's linter, and runs the end-to-end suite against the built Chrome package.

## 1.1.0
Much better search.

* **Query language:** `"exact phrases"`, `-word` to exclude, `OR`, and operators that combine freely: `from:`, `to:`, and `with:` (partial names, and `me`), `subject:`, `message:`, `before:`/`after:`/`during:` with a year, month, or day, `messages:>20` or `messages:5-10` for thread length, `has:link`, and `is:unread`, `is:saved`, `is:archived`, `is:draft`, or `is:modmail`. Unknown operators are searched as plain text.
* Matching ignores case and accents and finds parts of words.
* Results show an excerpt of the newest message that matched, with the words highlighted and a count when several messages matched.
* Opening a result expands the matching messages, highlights the words, and adds a find bar ("2 of 7 matches") to step through them with the arrows or `n` / `Shift+N`.
* A cheat-sheet of the syntax drops down when you click into the empty search box.

## 1.0.0: Dead Letter Office
First release under the new name. Dead Letter Office is a fork of YAIR 0.3.3; everything in the YAIR 0.4.0 notes below is included.

* **New name and identity:** Dead Letter Office, with a new airmail-envelope icon for the toolbar, extension page, favicon, and Reddit header, a new wordmark in the sidebar and popup, and updated settings and About text that credit YAIR.
* **New addresses:** the archive lives at `old.reddit.com/message/dlo_inbox` (and `dlo_saved`, `dlo_conversation/…`, and so on). Old `yair_` links still work and switch to the new address.
* Page title is now "Dead Letter Office"; exports are named `dead-letter-office_<user>_<date>`.
* Fresh README and screenshots; license carries both the new and the original copyright notices.

## YAIR 0.4.0 (unreleased, folded into 1.0.0)
Runs on Manifest V3, so YAIR loads in current Chrome again (Chrome removed Manifest V2 support in 2025). Firefox uses the same code.

**Platform**
* Background page replaced by a service worker (Chrome) / event page (Firefox) built from the same files.
* Settings and drafts moved from `localStorage` to `chrome.storage.local`. Existing settings, saved/archived lists, drafts, and the refresh interval are copied over automatically on first run.
* Notification polling uses `chrome.alarms`, so it keeps working after the service worker goes idle.
* Calls from the inbox to the background retry quietly when Chrome has stopped or restarted the service worker mid-call, instead of showing "the message channel closed before a response was received". If YAIR itself was reloaded or updated under an open tab, the page says to reload it.
* Database connections reopen on demand, so the inbox keeps working after the browser stops the idle service worker.
* jQuery updated from 3.4.1 to 3.7.1 (fixes CVE-2020-11022 and CVE-2020-11023). moment.js removed in favour of built-in `Intl` date formatting.

**Security**
* The toolbar popup built its list by concatenating message subjects and bodies into HTML. It now uses text nodes, so a crafted subject can't inject markup.
* The background message handler would call any function reachable from its global scope. It now only accepts an explicit allow-list, validates the username, and validates message IDs before building Reddit URLs.
* All Reddit requests use HTTPS (mark-as-read and notification links used `http://`).
* Correspondent names and authors are escaped before being put into HTML.
* Content scripts no longer run on plain `http://` pages or inside every iframe.

**Fixes**
* Searching with `message:` threw an error (it read the subject terms).
* Clicking the Archived folder's icon while reading a conversation archived that conversation. Header buttons were bound to every matching icon on the page, including the sidebar.
* Archiving from a conversation navigated twice (`history.back()` plus a push).
* In conversation view with "New Messages First", the export button showed the mark-read icon.
* The bulk "Mark Selected Read/Unread" buttons had each other's IDs.
* Folder filtering raced with rendering, so Drafts/Saved/Archived could show unfiltered conversations if the background answered out of order.
* Two users on one browser shared the same default config object, so their archived and saved lists could bleed into each other.
* Indexing could hang forever on an empty page or a network error, and its page counter was miscounted because of `this` misuse in `PMIndexer`. Errors are now reported.
* Incremental indexing anchored on the newest stored message, so messages added by the notifier could hide older unseen ones. It now walks newest-first and stops at the first page with nothing new.
* Exports only converted the first line break; file names could contain characters that are invalid on Windows.
* Compact mode couldn't be turned off without reloading.
* Reply failures now show Reddit's actual error (for example when a user only accepts Chat) and keep your draft, instead of a generic "not implemented" message.
* Opening a conversation sent one mark-read request per message; it now batches them and refreshes the toolbar badge.
* Several crashes on New Reddit pages when expected header elements were missing.

**Reddit's PM archive**
* Reddit stopped serving private message history through `message/messages.json` (it now returns an empty list) and redirects old Reddit's message pages to a read-only archive on new Reddit. YAIR now reads that archive page (`www.reddit.com/message/messages/`), follows its infinite-scroll pages (`/svc/shreddit/pm-archive/<cursor>`, paced and retried if Reddit rate limits), and stores the messages in the same local database, so search, folders, and export work as before. The JSON listing is still read too, in case Reddit delivers anything there.
* The archive list only previews the latest few messages of each conversation, so YAIR also reads each conversation's own page (`/message/messages/<id>/`) to get every message, following its "load more" chunks (`/svc/shreddit/pm-archive-message-replies/…`) until the whole thread is in. The first index reads them all; after that only conversations with newer activity are re-read, and an interrupted run carries on next time.
* Message bodies from the archive are Reddit's rendered HTML, so they're sanitized (no scripts, event handlers, or `javascript:` links) before display, and plain text is derived for search and export. Original Markdown isn't available from the archive. The archive list stops at about 1,000 messages, but each conversation's own page holds its full history.

**Interface**
* New look, "Airmail": the inbox is styled as an archive of letters. Navy ink on cool paper, Public Sans for the interface and Literata for message bodies and year headings (both bundled, SIL Open Font License), large sticky year numerals down the list, a mail-client grid (sender, subject over snippet, date), and conversations shown as a letter sheet with an airmail-stripe edge. Airmail red marks unread messages and drafts; blue marks actions and focus. Dark mode, compact mode, and narrow windows are all covered.
* Icons are now inline SVG, so they follow the theme colours and show up in Firefox (the old sprite sheet used Chrome-only URLs). The old `ui.css`, `alerts.css`, and `scss/` sources are replaced by a single `css/yair.css`.
* Summary line above the list: number of conversations and messages and the date range, or "N of M conversations match" while searching.
* Year dividers in the conversation list.
* Search updates as you type (in the current folder, not just the inbox), highlights matches, and has a clear button; Esc clears it.
* Message count badge on conversations with more than one message, and the full date on hover.
* The reply box now sits behind a notice that Reddit keeps these messages as a read-only archive, with a link to Reddit Chat and a "Reply here anyway" button. It opens straight away if you have a saved draft.
* Sort and filter bar above the list. Sort by latest activity, oldest activity, recently started, most messages, fewest messages, or name A to Z (remembered between visits). Filter by number of messages in the thread (quick presets 1, 2+, 5+, 10+, 25+, or an exact min/max range), by year, and by who sent the last message. Headings follow the sort: years for date sorts, size bands ("10 to 24 messages") for length sorts, initials for A to Z. Filters stack with search and folders, and "Clear filters" resets them.
* Toolbar popup has an **Open inbox** button (switches to an open YAIR tab if there is one), shows the unread count, and matches the new look, including dark mode.
* Theme setting: Light, Dark, or Match system (follows the OS light/dark setting live).
* Keyboard shortcuts: j/k to move, Enter or o to open, x to select, / to search, Esc or u to go back. Listed under Settings > About.

**New**
* Settings → Administration → **Export All** (text or JSON) downloads every stored conversation, including saved/archived flags in JSON.
* Search box placeholder lists the `from:`, `subject:`, and `message:` prefixes.
* Development tooling: ESLint, `web-ext lint`, an end-to-end test that drives the extension in Chromium against a mock Reddit, a zip build, and a GitHub Actions workflow running all of them.

## 0.3.3
* Fix Reindex function

## 0.3.2
* Fix for #25; archive/unarchive button now shows in conversation view depending on the status of the conversation

## 0.3.1
* Backend change to allow YAIR to continue working on Chrome 79+
* Fix for #22/23; Messages are marked read in the notifier when viewed.
* Going from a long message to the inbox now returns you to the top of the page

## 0.3.0
* add ability to export individual conversations (plaintext only exports with markdown)
* Buttons should all now have tooltips on hover
* Removed unneded mod-toolbox compatibility that was throwing errors

## 0.2.9.2
* Fix bug with accessing brand new PM chain from notifier
* Update to jquery 3.4.1 

## 0.2.9.1
* prevent correspondent being undefined from causing messages to fail to load.

## 0.2.9
* Firefox compatibility on a unified codebase, but for real this time.

## 0.2.8.2
* Clicking on the name of a subreddit you've sent a message to now correctly directs you to the subreddit.

## 0.2.8.1
* Revert to using Relative URL's, as using the absolute URL's were causing intermittent problems

## 0.2.8
* Make reindex work if in a message
* Almost complete cross-compatibility with Firefox version. Only thing that needs to be switched is chrome-extension for moz-extension
* Nightmode tweaks (address #17 and other small tweaks)
* Notes: Notifier currently doesn't work in Firefox unless content protection is totally turned off. This is, as far as I can tell, a limitation of the browser and not anything I can work around.

## 0.2.7
* added reindex button in admin panel

## 0.2.6
* Bump manifest version for release of first Firefox Version

## 0.2.3-0.2.5
* Series of quick formatting fixes

## 0.2.2
* Fix for messages from subreddits (Starting with #) showing as from "null" in notifications, and not showing in inbox

## 0.2.1
* What should be hopefully the last I see of bug #9.

## 0.2.0
* Removed superscript from fancy editor, as it was causing issues.
* Removed accidentally left-in debugging code

## 0.1.13
* Bugfix for 0.1.12; color wasn't changing right with newReddit icon.
* less hacky handling of superscript in visual editor

## 0.1.12
* Finished notifications in reddit on New Reddit to feature parity of old reddit (note: colors don't reset until refresh if switching to/from dark mode)
* Fix for #10

## 0.1.11
* Add (non-notifying) yair icon in New Reddit

## 0.1.10
* Removal of small amount of legacy code

## 0.1.9
* Another stab at fixing #9

## 0.1.8
* Revert Fix for #9

## 0.1.7
* Fix for #9; Updater isn't called when going directly into a PM. This  *should* fix that.
* Add Superscript option in visual editor
* Fix for #8; Editor content not always synchronized

## 0.1.5
* Added confirmation for resetting inbox
* Removed Code Block from Visual editor, as the markdown it was generating was broken.

## 0.1.4
* use the correct path for Icons
* Fix for #6
* Modmail options will now show up whether you've opted into the new modmail or not.

## 0.1.3
* Initial Release

See [github commit log](https://github.com/adhesivecheese/YAIR/commits/master) for all changes.
