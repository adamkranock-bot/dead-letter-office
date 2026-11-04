#!/bin/sh
# Wraps the Safari build in a macOS/iOS app with Apple's converter.
# Run on a Mac with Xcode installed, from the repository root:
#
#   npm run build:safari && sh scripts/safari.sh
#
# Then open the generated Xcode project, choose your Team under Signing &
# Capabilities, and press Run. For an unsigned local build, enable
# Safari > Settings > Advanced > "Show features for web developers", then
# Develop > "Allow Unsigned Extensions" (needed again after each Safari restart).
set -e

if ! command -v xcrun >/dev/null 2>&1; then
	echo "xcrun not found: this step needs macOS with Xcode installed." >&2
	exit 1
fi
if [ ! -f dist/safari/manifest.json ]; then
	echo "dist/safari is missing; run 'npm run build:safari' first." >&2
	exit 1
fi

xcrun safari-web-extension-converter dist/safari \
	--project-location dist/safari-xcode \
	--app-name "Dead Letter Office" \
	--bundle-identifier "com.adamkranockbot.deadletteroffice" \
	--copy-resources \
	--no-open \
	--force

echo "Xcode project written to dist/safari-xcode/"
