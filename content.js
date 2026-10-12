// PeaceOut: hooks Meet's camera, renders a smooth cross-fade between the
// live feed and a captured empty-room photo, and wires the peace-sign
// gesture (gesture.js) plus a keyboard shortcut to the fade trigger.
(() => {
  'use strict';
  const PO = (window.__peaceout = window.__peaceout || {});
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia || PO.installed) return;
  PO.installed = true;

  const DUR_MS = 1200;       // fade duration
  const BG_FRAMES = 12;      // frames averaged into the empty-room photo

  const state = { mode: 'live', bg: null, pipe: null }; // mode: live | fading-out | gone | fading-in
  let flashMsg = '', flashUntil = 0;
  let uiRefresh = () => {};
  function flash(msg, ms = 2200) { flashMsg = msg; flashUntil = performance.now() + ms; uiRefresh(); setTimeout(uiRefresh, ms + 50); }

  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  class Pipeline {
    constructor(video) {
      this.video = video;
      const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
      this.W = vw; this.H = vh;
      this.canvas = mkCanvas(this.W, this.H);
      this.ctx = this.canvas.getContext('2d');
      this.bg = null;
      this.t0 = 0;
      this.dead = false;
    }
    start() { this.timer = setInterval(() => this.frame(), 1000 / 30); this.frame(); }
    destroy() { this.dead = true; clearInterval(this.timer); if (state.pipe === this) state.pipe = null; }

    async captureBg() {
      const { W, H } = this;
      const acc = new Float32Array(W * H * 3);
      const grab = mkCanvas(W, H);
      const gctx = grab.getContext('2d', { willReadFrequently: true });
      for (let f = 0; f < BG_FRAMES; f++) {
        gctx.drawImage(this.video, 0, 0, W, H);
        const d = gctx.getImageData(0, 0, W, H).data;
        for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { acc[j] += d[i]; acc[j + 1] += d[i + 1]; acc[j + 2] += d[i + 2]; }
        await new Promise((r) => setTimeout(r, 40));
      }
      const out = gctx.createImageData(W, H);
      for (let i = 0, j = 0; i < out.data.length; i += 4, j += 3) {
        out.data[i] = acc[j] / BG_FRAMES; out.data[i + 1] = acc[j + 1] / BG_FRAMES; out.data[i + 2] = acc[j + 2] / BG_FRAMES; out.data[i + 3] = 255;
      }
      const bgCanvas = mkCanvas(W, H);
      bgCanvas.getContext('2d').putImageData(out, 0, 0);
      state.bg = bgCanvas;
      try {
        const s = mkCanvas(640, Math.round(640 * H / W));
        s.getContext('2d').drawImage(bgCanvas, 0, 0, s.width, s.height);
        localStorage.setItem('peaceout.bg', s.toDataURL('image/jpeg', 0.7));
      } catch (e) { /* storage can be blocked */ }
      state.mode = 'live';
    }

    loadSavedBg() {
      try {
        const url = localStorage.getItem('peaceout.bg');
        if (!url) return;
        const im = new Image();
        im.onload = () => {
          if (state.bg) return;
          const c = mkCanvas(im.naturalWidth, im.naturalHeight);
          c.getContext('2d').drawImage(im, 0, 0);
          state.bg = c;
          flash('saved empty room loaded', 2600);
        };
        im.src = url;
      } catch (e) { /* ignore */ }
    }

    // returns true if it actually toggled
    trigger() {
      if (!state.bg) { flash('capture the empty room first'); return false; }
      if (state.mode === 'live') { state.mode = 'fading-out'; this.t0 = performance.now(); return true; }
      if (state.mode === 'gone') { state.mode = 'fading-in'; this.t0 = performance.now(); return true; }
      return false; // already mid-fade
    }

    frame() {
      if (this.dead || this.video.readyState < 2) return;
      const { W, H, ctx } = this;
      if (state.mode === 'live' || !state.bg) {
        ctx.drawImage(this.video, 0, 0, W, H);
      } else if (state.mode === 'gone') {
        ctx.drawImage(state.bg, 0, 0, W, H);
      } else {
        const fadingOut = state.mode === 'fading-out';
        const t = Math.min(1, (performance.now() - this.t0) / DUR_MS);
        const e = t * t * (3 - 2 * t); // smoothstep
        const camAlpha = fadingOut ? 1 - e : e;
        ctx.drawImage(state.bg, 0, 0, W, H);
        if (camAlpha > 0.003) {
          ctx.globalAlpha = camAlpha;
          ctx.drawImage(this.video, 0, 0, W, H);
          ctx.globalAlpha = 1;
        }
        if (t >= 1) state.mode = fadingOut ? 'gone' : 'live';
      }
      uiRefresh();
    }
  }

  PO.getVideo = () => state.pipe && state.pipe.video;
  PO.toggle = () => {
    const p = state.pipe;
    if (!p) { flash('no camera yet'); return; }
    p.trigger();
    uiRefresh();
  };

  const origGUM = md.getUserMedia.bind(md);
  md.getUserMedia = async function (constraints) {
    if (!constraints || !constraints.video) return origGUM(constraints);
    const real = await origGUM(constraints);
    try {
      const vt = real.getVideoTracks()[0];
      if (!vt) return real;
      if (state.pipe) { try { state.pipe.destroy(); } catch (e) { /* ignore */ } flash('camera reopened — recapture if lighting changed', 3000); }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([vt]);
      await new Promise((res) => { video.onloadedmetadata = res; setTimeout(res, 3000); });
      await video.play().catch(() => {});

      const pipe = new Pipeline(video);
      pipe.start();
      pipe.loadSavedBg();
      state.pipe = pipe;
      PO.startGestureDetector();

      const outTrack = pipe.canvas.captureStream(30).getVideoTracks()[0];
      const realStop = outTrack.stop.bind(outTrack);
      const cleanup = () => { pipe.destroy(); try { vt.stop(); } catch (e) { /* ignore */ } };
      outTrack.stop = () => { realStop(); cleanup(); };
      vt.addEventListener('ended', () => { cleanup(); try { outTrack.dispatchEvent(new Event('ended')); } catch (e) { /* ignore */ } });
      const vs = vt.getSettings ? vt.getSettings() : {};
      outTrack.getSettings = () => Object.assign({}, vs, { width: pipe.W, height: pipe.H });
      outTrack.applyConstraints = async () => {};
      try { Object.defineProperty(outTrack, 'label', { value: vt.label }); } catch (e) { /* ignore */ }

      uiRefresh();
      return new MediaStream([outTrack, ...real.getAudioTracks()]);
    } catch (e) {
      console.warn('[peaceout] falling back to the normal camera', e);
      return real;
    }
  };

  // ---------- UI ----------
  function mountUI() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const el = (tag, props, kids) => {
      const n = document.createElement(tag);
      Object.assign(n, props || {});
      (kids || []).forEach((k) => n.appendChild(k));
      return n;
    };
    const style = el('style', { textContent: `
        *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
        .pill{display:flex;align-items:center;gap:8px;background:rgba(14,14,16,.88);color:#e9e9ee;
          border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:6px 12px;font-size:12px;
          backdrop-filter:blur(8px);user-select:none}
        .dot{width:8px;height:8px;border-radius:50%;background:#6b6b76}
        .dot.armed{background:#7cf0b4}.dot.gone{background:#b48cff}.dot.warn{background:#ffb86b}
        #st{cursor:pointer;letter-spacing:.02em}
        .panel{display:none;margin-top:8px;background:rgba(14,14,16,.92);color:#e9e9ee;border:1px solid rgba(255,255,255,.12);
          border-radius:14px;padding:10px;font-size:12px;gap:8px;flex-direction:column;width:230px}
        .panel.open{display:flex}
        button{background:#23232a;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 10px;
          font-size:12px;cursor:pointer}
        button:hover{background:#2e2e37}
        .hint{color:#8d8d9a;line-height:1.4}
      ` });
    const panel = el('div', { className: 'panel', id: 'panel' }, [
      el('button', { id: 'cap', textContent: 'capture empty room' }),
      el('button', { id: 'tg', textContent: 'fade out / in' }),
      el('div', { className: 'hint', id: 'handdbg', textContent: '' }),
      el('div', { className: 'hint', textContent: 'Step out of frame, press capture, wait 3 seconds. Then hold up a peace sign (✌️ two fingers) to fade out, and again to fade back in. Ctrl/Cmd + Shift + Y also works.' })
    ]);
    const pill = el('div', { className: 'pill' }, [
      el('span', { className: 'dot', id: 'dot' }),
      el('span', { id: 'st', textContent: 'peaceout' })
    ]);
    [style, pill, panel].forEach((n) => root.appendChild(n));
    const $ = (id) => root.getElementById(id);
    let open = false;

    function render() {
      $('panel').classList.toggle('open', open);
      const dot = $('dot'), st = $('st');
      let txt, cls = '';
      if (performance.now() < flashUntil) { txt = flashMsg; cls = 'warn'; }
      else if (!state.pipe) { txt = 'waiting for camera'; }
      else if (!state.bg) { txt = 'capture the room'; cls = 'warn'; }
      else if (state.mode === 'gone') { txt = 'vanished'; cls = 'gone'; }
      else if (state.mode === 'live') { txt = 'armed'; cls = 'armed'; }
      else txt = state.mode === 'fading-out' ? 'fading out' : 'fading in';
      dot.className = 'dot ' + cls;
      st.textContent = txt;
      const dbg = $('handdbg');
      if (dbg && PO.handDebug) dbg.textContent = 'hand: ' + PO.handDebug.state + (PO.handDebug.note ? ' — ' + PO.handDebug.note : '');
    }
    uiRefresh = render;

    $('st').addEventListener('click', () => { open = !open; render(); });
    $('tg').addEventListener('click', () => PO.toggle());
    $('cap').addEventListener('click', () => {
      const p = state.pipe;
      if (!p) return flash('no camera yet');
      flash('capturing in 3…', 1000);
      setTimeout(() => flash('capturing in 2…', 1000), 1000);
      setTimeout(() => flash('capturing in 1…', 1000), 2000);
      setTimeout(() => { flash('saving…', 900); p.captureBg().then(() => { open = false; flash('room saved'); }); }, 3000);
    });

    const hideToggle = () => { host.style.display = host.style.display === 'none' ? '' : 'none'; };
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyY') { e.preventDefault(); PO.toggle(); }
    }, true);
    window.addEventListener('po-toggle', () => PO.toggle());

    (document.body || document.documentElement).appendChild(host);
    render();
    setInterval(render, 1000);
  }

  const safeMount = () => { try { mountUI(); } catch (e) { console.error('[peaceout] could not draw the control pill', e); } };
  if (document.body) safeMount();
  else document.addEventListener('DOMContentLoaded', safeMount);
})();
