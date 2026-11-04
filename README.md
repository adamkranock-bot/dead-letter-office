# YAIR

YAIR (Yet Another Inbox Revamp) is a browser extension for Chrome and Firefox that overhauls the Reddit private messaging system, providing a more streamlined interface for dealing with private messages.

> **Version 0.4.0 runs on Manifest V3.** Chrome stopped running Manifest V2 extensions in 2025 (Chrome 138/139), so earlier versions of YAIR no longer load there. 0.4.0 works on current Chrome (121+) and Firefox (121+), and your saved/archived lists, drafts, and settings carry over automatically when you upgrade.
>
> **Reddit has moved direct messages to Chat.** Reddit now describes legacy private messages as a read-only archive, so most new conversations happen in Chat instead of here, and replies to old threads may be refused. When Reddit refuses a reply, YAIR shows Reddit's reason and keeps your draft. YAIR now reads your history from Reddit's archive page (`www.reddit.com/message/messages/`), so it's still a fast, searchable, local copy of your PM history, and **Settings → Administration → Export All** saves the whole archive as text or JSON.

## Tell me more!

A picture's worth a thousand words, so let's start there:

![inbox View](images/promotional/inbox_view.png)
      
YAIR isn't just a pretty frontend for your inbox; it provides functionality on top, largely inspired by Gmail. You can save or archive message threads on a thread-by-thread basis, or select multiple message threads to perform bulk actions on them. YAIR saves drafts for you automatically, so if you get interrupted writing your message, you can close the page and pick up right where you left off later.

Think the interface takes up too much room? There's a toggle for compact mode, suitable for smaller screens. Too much white? There's also a night mode, which also integrates with the Reddit Enhancement Suite's night mode.

![compact night view](images/promotional/night_compact.PNG)

YAIR automatically checks for messages and shows the unread count on its toolbar button. You can click the message to be taken directly to the message within YAIR.

![notifications](images/promotional/notifier.PNG)

YAIR provides a What-You-See-Is-What-You-Get reply box; no more writing markdown by hand (unless you're into that sort of thing)

![editor](images/promotional/editor.PNG)

## Installing from source

1. Download or clone this repository (or grab `yair-<version>.zip` from a CI build and unzip it).
2. **Chrome / Edge / Brave:** open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked*, and pick the folder that contains `manifest.json`.
3. **Firefox:** open `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on…*, and pick `manifest.json`. Firefox may ask you to allow access to reddit.com; YAIR needs it to read your messages.
4. Log in to Reddit and open <https://old.reddit.com/message/yair_inbox>.

## Development

```sh
npm install
npm run lint            # ESLint (catches undefined names, MV3 service-worker misuse)
npm run lint:firefox    # Mozilla's add-on linter
npm run test:e2e        # loads the extension in Chromium against a mock Reddit (needs openssl)
npm run build           # zips the extension into dist/
```

There is no bundler: the files listed in `manifest.json` are loaded as-is.

* `js/background/` runs as a service worker in Chrome (`service-worker.js` imports the other files) and as an event page in Firefox (the `background.scripts` list). Keep the two lists in sync. It owns all persistent state (`chrome.storage.local` plus one IndexedDB database per Reddit user) and all requests that the content scripts can't make themselves.
* Content scripts call background functions through `yair.proxy([...path], params, callback)`. Only paths listed in `PROXY_WHITELIST` in `bg-proxy.js` can be called.
* `js/content-inbox/` renders the inbox on `old.reddit.com/message/yair_*` pages; `js/notifications/fetch.js` is the toolbar popup.
* `css/*.css` is compiled from `scss/`, so edit both if you change styles.

Publishing to addons.mozilla.org requires adding the existing listing's add-on ID under `browser_specific_settings.gecko.id` in `manifest.json` (Firefox requires an ID for Manifest V3 add-ons).

## F.A.Q.

### Is this safe?

Absolutely! YAIR operates on a copy of your messages; the only things it can do to your original messages are mark them as read and send the replies you write.

Everything is also completely local; as long as you can trust your browser's cookies, you can trust YAIR. Nothing is synced to "the cloud". YAIR only talks to reddit.com.

### I already use RIR. Why would I want to use YAIR instead?

If you're happy with RIR, there's absolutely no reason to! YAIR originally began life as a couple of quick hacks to RIR to address some personal frustrations with the user interface. As time went on, the modifications got to the point that it made sense to publish my code as a separate extension.

## Credits
YAIR is built on top of [Goctionni's Reddit Inbox Revamp](https://github.com/Goctionni/RedditInboxRevamp).

### It also includes code from:
[Reddit Notifier](https://github.com/kaypoz/reddit-notifier)

[Quill](https://github.com/quilljs/quill)

[JQuery Grab Bag](https://github.com/jaz303/jquery-grab-bag)
