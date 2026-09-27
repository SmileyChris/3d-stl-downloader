// Toolbar icon click: ask hook.js (MAIN world) in the active tab to export.
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => window.dispatchEvent(new Event('tripo-stl-export')),
  }).catch(() => {}); // not a Tripo/Meshy tab: nothing to export
});
