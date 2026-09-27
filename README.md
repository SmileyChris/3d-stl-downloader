# 3D STL Downloader

Browser extension that saves the model shown in the [Tripo3D](https://studio.tripo3d.ai) or [Meshy](https://www.meshy.ai) 3D preview as a binary STL, straight from the page's three.js scene. No API calls, no credits: it writes out exactly the geometry the viewer is rendering.

## Install

**Chrome / Edge / Brave:** `chrome://extensions` → enable Developer mode → **Load unpacked** → pick the `extension/` folder.

**Firefox (140+):** `about:addons` → gear → **Install Add-on From File…** → pick the signed `.xpi` from the latest [release](../../releases/latest). For quick testing without signing: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `extension/manifest.json` (removed on restart).

To sign a new build (unlisted, via addons.mozilla.org): bump `version` in `extension/manifest.json`, then run `npx web-ext sign` and attach the `.xpi` from `web-ext-artifacts/` to a GitHub release. Settings come from `web-ext-config.mjs`; AMO API keys from `~/.web-ext-config.mjs` (`sign.apiKey` / `sign.apiSecret`).

After editing the code, hit reload on the extension and refresh the site's tab.

## Use

Open a model, then either:

- click the site's own button, which the extension takes over: **Export STL** on Tripo, **⬇ STL** on Meshy (Shift+click for the site's original export/download), or
- click the extension's toolbar icon.

A toast shows the triangle count when the file is saved.

File names: Meshy uses the model's name (falling back to the parent model's name for unnamed texture/remesh versions); otherwise the last segment of the page URL.

## How it works

- `hook.js` runs in the page at `document_start` and defines `window.__THREE_DEVTOOLS__`. three.js announces every scene it creates to that object, so the extension gets live references to the viewer's scenes.
- `stl.js` picks the model meshes (Tripo: meshes named `tripo*`; otherwise every mesh with at least 1% of the largest mesh's triangles, which drops gizmos and helpers), applies world transforms, converts Y-up to Z-up, and writes binary STL.
- On Meshy, `hook.js` also watches the app's own `/meshyd-api/web/v2/tasks/<id>` responses to learn the model name. It never makes requests itself.

The export is the preview mesh, so resolution matches what the viewer loaded.

## Test

```sh
node --test test/stl.test.js
npx web-ext lint --source-dir extension   # Firefox manifest check
```

## Fragile bits

These rely on site internals and may break when the sites update:

- Button selectors: `button[data-trace-key$="export_button"]` (Tripo), `button[data-testid="viewer-download-btn"]` (Meshy).
- Meshy task API path used for names (falls back to the URL slug if it changes).
- Tripo promo-card hiding in `hook.js`.

## License

MIT
