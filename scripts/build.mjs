// Builds a package for each browser from the same source.
//
//   node scripts/build.mjs            all targets
//   node scripts/build.mjs firefox    just one (chrome, edge, firefox, safari)
//
// Output: dist/<target>/ (unpacked, ready for "Load unpacked") and
// dist/dead-letter-office-<version>-<target>.zip. The Safari folder is the
// input for Apple's converter (see scripts/safari.sh, which runs on a Mac).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const VERSION = source.version;

// Firefox add-on ID. AMO ties the listing to this, so never change it once published.
const GECKO_ID = 'dead-letter-office@adamkranock-bot';

// Files that are for development only
const EXCLUDE = [
	/^\.git(\/|$)/, /^\.github\//, /^\.gitignore$/, /^node_modules\//, /^dist\//, /^test\//, /^scripts\//,
	/^images\/promotional\//, /\.md$/, /^package(-lock)?\.json$/, /^eslint\.config\.js$/,
];

const clone = (o) => JSON.parse(JSON.stringify(o));
const withoutPermission = (m, name) => { m.permissions = (m.permissions || []).filter((p) => p !== name); return m; };

const TARGETS = {
	// Chrome, Brave, Opera, Vivaldi: service worker background, offscreen document for the MV2 migration
	chrome(m) {
		m.background = { service_worker: m.background.service_worker };
		delete m.browser_specific_settings;
		return m;
	},
	// Microsoft Edge is Chromium; same package, separate zip for the Edge Add-ons store
	edge(m) {
		return TARGETS.chrome(m);
	},
	// Firefox: event-page background, AMO add-on ID and data-collection declaration
	firefox(m) {
		m.background = { scripts: m.background.scripts };
		withoutPermission(m, 'offscreen');
		delete m.minimum_chrome_version;
		m.browser_specific_settings = {
			gecko: {
				id: GECKO_ID,
				// 140 (the current ESR) understands data_collection_permissions;
				// 127+ also asks for the reddit.com permission at install time
				strict_min_version: '140.0',
				data_collection_permissions: { required: ['none'] },
			},
			gecko_android: { strict_min_version: '142.0' },
		};
		return m;
	},
	// Safari (macOS and iOS): event-page background; wrapped into an app by Xcode's converter
	safari(m) {
		m.background = { scripts: m.background.scripts };
		withoutPermission(m, 'offscreen');
		delete m.minimum_chrome_version;
		delete m.browser_specific_settings;
		return m;
	},
};

function listFiles(dir = ROOT, prefix = '') {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix + entry.name;
		if (EXCLUDE.some((re) => re.test(rel) || re.test(rel + '/'))) continue;
		if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel + '/'));
		else if (rel !== 'manifest.json') out.push(rel);
	}
	return out;
}

function build(target) {
	const outDir = path.join(DIST, target);
	fs.rmSync(outDir, { recursive: true, force: true });
	for (const rel of listFiles()) {
		const dest = path.join(outDir, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(ROOT, rel), dest);
	}
	const manifest = TARGETS[target](clone(source));
	fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	const zip = `dead-letter-office-${VERSION}-${target}.zip`;
	execFileSync('npx', ['--no-install', 'web-ext', 'build', '--source-dir', outDir, '--artifacts-dir', DIST,
		'--filename', zip, '--overwrite-dest'], { stdio: 'ignore' });
	console.log(`${target.padEnd(8)} dist/${target}/  dist/${zip}`);
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((t) => !TARGETS[t]);
if (unknown.length) {
	console.error(`Unknown target: ${unknown.join(', ')}. Choose from ${Object.keys(TARGETS).join(', ')}.`);
	process.exit(1);
}
fs.mkdirSync(DIST, { recursive: true });
(wanted.length ? wanted : Object.keys(TARGETS)).forEach(build);
