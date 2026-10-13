// PeaceOut: peace-sign (two fingers) gesture detector. Watches the same
// camera feed content.js already has open, with MediaPipe HandLandmarker
// bundled locally inside the extension so nothing is fetched from a CDN
// at runtime.
(() => {
  'use strict';
  const PO = (window.__peaceout = window.__peaceout || {});

  // Meet enforces Trusted Types (require-trusted-types-for 'script'), and
  // MediaPipe's internal WASM loader creates a <script src="..."> with a
  // plain string, which that policy rejects outright. Installing a
  // permissive 'default' policy is the standard migration path for a
  // third-party library that is not Trusted-Types-aware; it only works if
  // nothing on the page has already claimed the 'default' name, which is
  // why this runs first, at document_start, before Meet's own scripts.
  try {
    if (window.trustedTypes && trustedTypes.createPolicy && !window.__poTT) {
      window.__poTT = trustedTypes.createPolicy('default', {
        createScriptURL: (url) => url,
        createScript: (s) => s,
        createHTML: (s) => s,
      });
    }
  } catch (e) { console.warn('[peaceout] could not install a Trusted Types default policy', e); }

  // The MAIN world has no chrome.runtime; bridge.js (isolated world) hands
  // us the extension's base URL over a DOM event.
  let baseUrl = null;
  const baseWaiters = [];
  window.addEventListener('po-base', (e) => {
    if (baseUrl) return;
    baseUrl = e.detail;
    baseWaiters.splice(0).forEach((fn) => fn(baseUrl));
  });
  function getBase() {
    if (baseUrl) return Promise.resolve(baseUrl);
    return new Promise((res) => { baseWaiters.push(res); setTimeout(() => res(baseUrl), 4000); });
  }

  PO.handDebug = { state: 'idle', note: '' };
  function setDebug(state, note) {
    PO.handDebug = { state, note: note || '' };
    console.log('[peaceout] hand:', state, note || '');
  }

  let landmarker = null;
  let loading = null;
  async function makeLandmarker(base, delegate) {
    const mod = await import(base + 'mediapipe/vision_bundle.mjs');
    const { HandLandmarker, FilesetResolver } = mod;
    const files = await FilesetResolver.forVisionTasks(base + 'mediapipe/wasm');
    return HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: base + 'mediapipe/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  }
  async function loadLandmarker() {
    if (landmarker) return landmarker;
    if (loading) return loading;
    setDebug('loading');
    loading = (async () => {
      const base = await getBase();
      if (!base) throw new Error('no extension base url (bridge did not respond)');
      try {
        landmarker = await makeLandmarker(base, 'GPU');
      } catch (e) {
        console.warn('[peaceout] GPU hand model failed, trying CPU', e);
        landmarker = await makeLandmarker(base, 'CPU');
      }
      setDebug('ready');
      return landmarker;
    })().catch((e) => {
      setDebug('error', String(e && e.message || e));
      loading = null;
      throw e;
    });
    return loading;
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Peace sign: index + middle clearly extended, ring + pinky clearly
  // curled. Measured as each fingertip's distance from the wrist relative
  // to its own knuckle's distance from the wrist, so it holds at any hand
  // size or camera distance.
  const EXT_T = 1.2, CURL_T = 1.15;
  function peaceMetrics(lm) {
    const wrist = lm[0];
    const r = (tip, mcp) => dist(wrist, lm[tip]) / Math.max(1e-5, dist(wrist, lm[mcp]));
    return { index: r(8, 5), middle: r(12, 9), ring: r(16, 13), pinky: r(20, 17) };
  }
  function isPeaceSign(m) {
    return m.index > EXT_T && m.middle > EXT_T && m.ring < CURL_T && m.pinky < CURL_T;
  }

  let timer = null;
  let hitStreak = 0;
  let lastFire = 0;
  let armed = true;         // must drop the pose once before it can fire again
  const HITS_NEEDED = 3;    // ~3 consecutive positive frames before it counts
  const COOLDOWN_MS = 1500;
  const POLL_MS = 90;

  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const video = PO.getVideo && PO.getVideo();
      if (!video || video.readyState < 2) {
        hitStreak = 0;
        if (PO.handDebug.state !== 'loading' && PO.handDebug.state !== 'error') setDebug('waiting for camera');
        return;
      }
      const lmk = await loadLandmarker();
      const res = lmk.detectForVideo(video, performance.now());
      const hands = res && res.landmarks;
      if (hands && hands.length) {
        const m = peaceMetrics(hands[0]);
        const seen = isPeaceSign(m);
        const now = performance.now();
        const cooling = now - lastFire < COOLDOWN_MS;
        let peaceNote = '';
        if (seen) {
          if (cooling) peaceNote = ' · PEACE (cooling down)';
          else if (!armed) peaceNote = ' · PEACE (lower your hand to re-arm)';
          else peaceNote = ` · PEACE ${Math.min(hitStreak + 1, HITS_NEEDED)}/${HITS_NEEDED}`;
        }
        PO.handDebug = { state: 'ready', note:
          `hand seen · i${m.index.toFixed(2)} m${m.middle.toFixed(2)} r${m.ring.toFixed(2)} p${m.pinky.toFixed(2)}` + peaceNote };
        if (seen) {
          hitStreak++;
          if (!cooling && armed && hitStreak >= HITS_NEEDED) {
            lastFire = now;
            hitStreak = 0;
            armed = false;
            if (PO.toggle) PO.toggle();
          }
        } else {
          hitStreak = 0;
          armed = true;
        }
      } else {
        hitStreak = 0;
        PO.handDebug = { state: 'ready', note: 'no hand in frame' };
      }
    } catch (e) {
      console.warn('[peaceout] gesture tick failed', e);
      setDebug('error', String(e && e.message || e));
    } finally {
      busy = false;
    }
  }

  PO.startGestureDetector = () => { if (!timer) timer = setInterval(tick, POLL_MS); };
  PO.stopGestureDetector = () => { if (timer) { clearInterval(timer); timer = null; hitStreak = 0; } };
})();
