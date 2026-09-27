// Runs in the page's MAIN world at document_start, before three.js loads.
// three.js announces every Scene it constructs on window.__THREE_DEVTOOLS__
// when that object exists, so defining it here hands us the live scenes.
(function () {
  'use strict';

  const { meshesToStl, collectMeshes, triangleCount } = window.__tripoStl;
  const sceneRefs = [];

  if (typeof window.__THREE_DEVTOOLS__ === 'undefined') {
    window.__THREE_DEVTOOLS__ = new EventTarget();
  }
  window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
    const object = event.detail;
    if (object && object.isScene) sceneRefs.push(new WeakRef(object));
  });

  function liveScenes() {
    return sceneRefs.map((ref) => ref.deref()).filter(Boolean);
  }

  // Meshy's workspace URL never names the model, but selecting one makes the
  // app XHR its task JSON (then the parent's, for unnamed texture/remesh
  // passes). Remember those responses; we never make requests of our own.
  const MESHY_TASK = /\/meshyd-api\/web\/v2\/tasks\/[0-9a-f-]{36}(\?|$)/;
  const meshyTasks = new Map();
  let meshyCurrent = null;

  if (/(^|\.)meshy\.ai$/.test(location.hostname)) {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (MESHY_TASK.test(String(url))) {
        this.addEventListener('load', () => {
          try {
            const task = JSON.parse(this.responseText).result;
            if (!task || !task.id) return;
            meshyTasks.set(task.id, task);
            // A parent fetched for the current task isn't a new selection.
            if (!meshyCurrent || meshyCurrent.parent !== task.id) meshyCurrent = task;
          } catch (error) {
            // not JSON; ignore
          }
        });
      }
      return open.call(this, method, url, ...rest);
    };
  }

  function meshyName() {
    for (let task = meshyCurrent; task; task = meshyTasks.get(task.parent)) {
      if (task.name) return task.name;
    }
    return '';
  }

  function fileName() {
    const slug = meshyName() || location.pathname.split('/').filter(Boolean).pop() || 'model';
    return slug.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) + '.stl';
  }

  function exportStl() {
    const meshes = collectMeshes(liveScenes());
    if (!meshes.length) throw new Error('No model found — reload page');
    for (const mesh of meshes) {
      if (typeof mesh.updateWorldMatrix === 'function') mesh.updateWorldMatrix(true, false);
    }
    const blob = new Blob([meshesToStl(meshes)], { type: 'model/stl' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName();
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    return meshes.reduce((sum, mesh) => sum + triangleCount(mesh.geometry), 0);
  }

  // The page's own Export/Download button (Tripo, Meshy); text match is the fallback if the key changes.
  const EXPORT_BUTTON = 'button[data-trace-key$="export_button"], button[data-testid="viewer-download-btn"]';
  const EXPORT_LABEL = /^Export( STL)?$/;
  let toast = null;
  let toastTimer = 0;
  let busy = false;

  function notify(text, sticky) {
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;' +
        'border-radius:8px;background:#f5c518;color:#111;pointer-events:none;' +
        'font:600 13px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)';
    }
    toast.textContent = text;
    // Attach to <html>, not <body>: the app's hydration replaces body children.
    document.documentElement.appendChild(toast);
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => toast.remove(), 3000);
  }

  function runExport() {
    if (busy) return;
    busy = true;
    notify('Exporting STL…', true);
    // Defer so the toast paints before the export blocks the main thread.
    setTimeout(() => {
      try {
        notify(exportStl().toLocaleString() + ' triangles saved');
      } catch (error) {
        console.error('[tripo-stl]', error);
        notify(error.message);
      }
      busy = false;
    }, 50);
  }

  // Fired by background.js when the extension's toolbar icon is clicked.
  window.addEventListener('tripo-stl-export', runExport);

  function isExportButton(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(EXPORT_BUTTON)) return true;
    const button = target.closest('button');
    return !!button && EXPORT_LABEL.test(button.textContent.trim());
  }

  // Hide the logged-out "Start creating in minutes" promo card. It has no
  // stable id, so match its fixed-corner utility classes plus its heading.
  const PROMO_CARD = 'div.fixed.bottom-6.right-6';
  const PROMO_TEXT = /start creating in minutes/i;
  let pageScan = 0;

  // Relabel the hijacked button so it says what it now does.
  function relabelExport() {
    for (const button of document.querySelectorAll(EXPORT_BUTTON)) {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode()); ) {
        if (node.nodeValue.trim() === 'Export') node.nodeValue = 'Export STL';
      }
      // Icon-only buttons (Meshy) get a label after the icon.
      if (!button.textContent.trim()) button.append('STL');
      button.title = "Export STL from preview (Shift+click for the site's download)";
    }
  }

  function tidyPage() {
    pageScan = 0;
    relabelExport();
    for (const card of document.querySelectorAll(PROMO_CARD)) {
      if (PROMO_TEXT.test(card.textContent)) card.style.setProperty('display', 'none', 'important');
    }
  }

  // The app is an SPA and re-renders both, so rescan (once per frame) on DOM changes.
  new MutationObserver(() => {
    if (!pageScan) pageScan = requestAnimationFrame(tidyPage);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Take over the page's Export button. Registered on window in the capture
  // phase at document_start, so it runs before any of the app's handlers.
  // Shift+click falls through to the site's own export.
  window.addEventListener(
    'click',
    (event) => {
      if (event.shiftKey || !isExportButton(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runExport();
    },
    true
  );
})();
