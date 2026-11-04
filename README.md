# Dead Letter Office

**A searchable, exportable archive of your Reddit private messages.**

Reddit moved direct messages to Chat and turned years of private messages into a read-only archive that's slow to browse and impossible to search. Dead Letter Office keeps a complete copy of that archive in your browser and gives it a proper reading room: search, folders, sorting by thread length, and exports you can keep.

![The conversation list](images/promotional/inbox.png)

## What it does

* **Reads your whole archive.** It walks Reddit's PM archive, then opens every conversation and follows its "load more" pages, so even 700-message threads come in complete. After the first run it only re-reads conversations with new activity.
* **Search** as you type, ignoring case and accents. Use `"exact phrases"`, `-exclude`, `OR`, `from:`/`to:`/`with:`, `subject:`/`message:`, `before:`/`after:`/`during:` dates, `messages:>20`, `has:link`, and `is:saved` (the full list drops down when you click into the search box). Results show the message that matched, and opening one jumps you to each match in turn.
* **Sort and filter** by latest activity, when a conversation started, most or fewest messages, or name, and narrow by message count (1, 2+, 5+, 10+, 25+, or any range), year, and who wrote last. Sorting by *Most messages* is the quickest way to find your longest conversations.
* **Folders** for Saved and Archived, plus bulk actions.
* **Read comfortably.** Conversations open as a letter at a readable width, in Literata, with light, dark, or match-system themes.
* **Export, back up, and restore.** Export a single conversation as text, or everything as text or a JSON backup (with your saved and archived flags), and restore a backup into a new browser or profile, from **Settings → Administration**.
* **Unread badge.** The toolbar button checks for unread messages every 15 minutes (or 5, 30, 60, or never; see Settings) and has an **Open inbox** button.
* **Read-only, like Reddit's archive.** Reddit no longer accepts replies to archived messages, so there's no reply box; reply on Reddit Chat instead.
* **Keyboard friendly.** Use `j`/`k` to move, `Enter` to open, `x` to select, `/` to search, and `Esc` to go back.

![A conversation](images/promotional/conversation.png)

Everything stays on your computer. The extension only talks to reddit.com, using the login you already have.

## Install

Each release has a package per browser: `dead-letter-office-<version>-<browser>.zip`. You can also build them yourself with `npm run build`. Unzip the one for your browser, then:

**Chrome, Brave, Opera, or Vivaldi** (`…-chrome.zip`): open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked*, and choose the unzipped folder.

**Microsoft Edge** (`…-edge.zip`): open `edge://extensions`, turn on *Developer mode*, click *Load unpacked*, and choose the unzipped folder. The same zip is what you upload to the Edge Add-ons store.

**Firefox 140 or later** (`…-firefox.zip`): for a quick try, open `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on…*, and choose `manifest.json` (it's removed when Firefox restarts). For a permanent install, submit the zip to [addons.mozilla.org](https://addons.mozilla.org/developers/) for signing, either listed or "on your own" (unlisted), then install the signed `.xpi`. Allow access to reddit.com when Firefox asks.

**Safari (macOS, and iOS/iPadOS)** (`…-safari.zip`): Safari extensions ship inside an app, which Apple's tools build on a Mac with Xcode:

```sh
npm run build:safari
sh scripts/safari.sh            # runs xcrun safari-web-extension-converter
```

Open the Xcode project it creates in `dist/safari-xcode/`, pick your Team under *Signing & Capabilities*, and press Run. Then turn the extension on in Safari's Settings → Extensions and allow it on reddit.com. Unsigned local builds also need *Develop → Allow Unsigned Extensions*. Publishing to the App Store needs an Apple Developer account.

Then log in to Reddit and open <https://old.reddit.com/message/dlo_inbox>, or click the toolbar button and choose **Open inbox**. The first visit reads your whole archive, which can take a few minutes for a large one.

To update, replace the files in the same folder and reload the extension. Keeping the same folder keeps your stored messages, flags, and settings. Before switching browsers or profiles, make a JSON backup (Settings → Administration) and restore it on the other side.

## Troubleshooting

If the archive stops filling in, Reddit may have changed its page. The archive shows a banner saying so and keeps everything already stored. **Settings → Administration → Download diagnostics** saves a small file for a bug report: counts, timings, and the page's structure, with no message text, subjects, or usernames.

![Dark mode, sorted by thread length](images/promotional/inbox-dark.png)

## Development

```sh
npm install
npm run lint            # ESLint (undefined names, MV3 service-worker misuse)
npm run lint:firefox    # Mozilla's add-on linter
npm run test:unit       # parser, sanitiser, restore, and search against real (redacted) archive markup
npm run test:e2e        # drives the extension in Chromium against a mock Reddit (needs openssl)
npm run build           # packages for chrome, edge, firefox, and safari in dist/
npm run build:firefox   # or one browser at a time
```

There is no bundler: the files listed in `manifest.json` are loaded as they are.

* `manifest.json` in the repository works as-is for development in Chrome and Firefox. `scripts/build.mjs` derives each browser's manifest from it: a service worker for Chrome and Edge; an event page, add-on ID, and data-collection declaration for Firefox; an event page for Safari.
* `js/background/` runs as a service worker in Chrome and Edge (`service-worker.js` imports the other files) and as an event page in Firefox and Safari (the `background.scripts` list); keep the two lists in sync. It owns persistent state (`chrome.storage.local` and one IndexedDB database per Reddit user) and fetches from Reddit.
* `js/content-inbox/` renders the archive on `old.reddit.com/message/dlo_*` pages: `view-*.js` draw the page, `controller*.js` handle actions, `model.js` sorts and filters, `keyboard.js` has the shortcuts, and `main.js` starts it all. `dbhelper.js` reads Reddit's archive (`www.reddit.com/message/messages/`, its `pm-archive` list pages, each conversation's page, and its `pm-archive-message-replies` chunks).
* Content scripts call the background through `dlo.proxy([...path], params, callback)`; only paths in `PROXY_WHITELIST` (`bg-proxy.js`) are allowed.
* `css/dlo.css` is the whole theme (colour tokens at the top, light and dark). Icons are inline SVG. Fonts (Public Sans and Literata, SIL OFL) live in `fonts/`.
* Old `/message/yair_*` addresses redirect to `/message/dlo_*`. Data from YAIR-era installs (the `YAIR_USER_CONFIG` setting and `YAIR_Messages<user>` databases) is moved to the `DLO_` names on first use.

The Firefox add-on ID (`dead-letter-office@adamkranock-bot`, set in `scripts/build.mjs`) is permanent once published to addons.mozilla.org.

## Credits

Dead Letter Office is a fork of [YAIR](https://github.com/adhesivecheese/YAIR) (Yet Another Inbox Revamp) by [/u/AdhesiveCheese](https://www.reddit.com/user/adhesivecheese), which was built on [Goctionni's Reddit Inbox Revamp](https://github.com/Goctionni/RedditInboxRevamp) and includes code from [Reddit Notifier](https://github.com/kaypoz/reddit-notifier). Fonts are [Public Sans](https://github.com/uswds/public-sans) and [Literata](https://github.com/googlefonts/literata).

MIT licensed; see [LICENSE](LICENSE). Not affiliated with or endorsed by Reddit.
