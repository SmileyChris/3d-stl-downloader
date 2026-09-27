#!/bin/sh
# Build, sign and publish a GitHub release for the version in extension/manifest.json.
# Bump the version and commit first. AMO keys come from ~/.web-ext-config.mjs.
set -eu
cd "$(dirname "$0")"

v=$(node -p "require('./extension/manifest.json').version")
out=web-ext-artifacts
name=3d-stl-downloader-$v

[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first." >&2; exit 1; }

node --test test/stl.test.js
npx web-ext lint

# AMO won't re-sign a version, so reuse an existing signed build.
ls "$out"/*-"$v".xpi >/dev/null 2>&1 || npx web-ext sign
cp "$(ls -t "$out"/*-"$v".xpi | head -1)" "$out/$name-firefox.xpi"

npx web-ext build --overwrite-dest --filename "$name-chrome.zip"

git push
gh release create "v$v" \
  "$out/$name-firefox.xpi#Firefox (signed)" \
  "$out/$name-chrome.zip#Chrome / Edge / Brave (unzip, Load unpacked)" \
  --generate-notes
