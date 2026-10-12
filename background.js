// PeaceOut: service worker. Keyboard shortcuts are delivered here by Chrome
// and have to be relayed into the Meet tab by message.
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-vanish') return;
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { peaceout: 'toggle' }).catch(() => {});
  });
});
