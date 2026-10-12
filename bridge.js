// PeaceOut: isolated-world bridge. The camera hook has to live in the MAIN
// world (it needs to see Meet's own getUserMedia function), but only the
// isolated world gets chrome.runtime, so both the keyboard shortcut and the
// extension's own base URL hop across as a DOM event.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.peaceout !== 'toggle') return;
  try { window.dispatchEvent(new CustomEvent('po-toggle')); } catch (e) { /* ignore */ }
});

try {
  const base = chrome.runtime.getURL('');
  const send = () => { try { window.dispatchEvent(new CustomEvent('po-base', { detail: base })); } catch (e) { /* ignore */ } };
  [0, 50, 200, 1000].forEach((ms) => setTimeout(send, ms));
} catch (e) { /* ignore */ }
