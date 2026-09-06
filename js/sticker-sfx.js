/* Hero stickers — Holden calls out RADIO / OPENSEA / AVATAR on hover + tap, through the stadium echo. */
(function () {
  const stickers = document.querySelectorAll("#stickers .sticker[data-say]");
  if (!stickers.length) return;
  const assetUrl = p => (window.__SPRITE_DATA && window.__SPRITE_DATA[p]) || p;
  let ctx, clips = {}, last = 0;
  const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  function load(name) {
    if (clips[name]) return Promise.resolve(clips[name]);
    const url = assetUrl(`assets/sfx/say-${name}.mp3`);
    const bytes = url.startsWith("data:") ? Promise.resolve(Uint8Array.from(atob(url.split(",")[1]), ch => ch.charCodeAt(0)).buffer) : fetch(url).then(r => r.arrayBuffer());
    return bytes.then(b => ac().decodeAudioData(b)).then(buf => (clips[name] = buf));
  }
  function play(buf) {
    const c = ac(); if (c.state === "suspended") c.resume();
    const t = c.currentTime + 0.01, src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = 0.94;
    const dry = c.createGain(); dry.gain.value = 0.9; const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
    const d1 = c.createDelay(1); d1.delayTime.value = 0.16; const f1 = c.createGain(); f1.gain.value = 0.42;
    const d2 = c.createDelay(1); d2.delayTime.value = 0.31; const f2 = c.createGain(); f2.gain.value = 0.3;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600; const wet = c.createGain(); wet.gain.value = 0.55;
    src.connect(dry).connect(comp); src.connect(d1); d1.connect(f1); f1.connect(lp); f1.connect(d1); src.connect(d2); d2.connect(f2); f2.connect(lp); f2.connect(d2);
    lp.connect(wet).connect(comp); comp.connect(c.destination); src.start(t);
  }
  function say(name) { const now = Date.now(); if (now - last < 700) return; last = now; load(name).then(play).catch(() => {}); }
  let armed = false;
  const arm = () => { if (armed) return; armed = true; ac(); stickers.forEach(s => load(s.dataset.say).catch(() => {})); };
  document.addEventListener("pointerdown", arm, { once: true }); document.addEventListener("keydown", arm, { once: true });
  stickers.forEach(s => {
    s.addEventListener("pointerenter", e => { if (e.pointerType === "mouse" && armed) say(s.dataset.say); });
    s.addEventListener("pointerdown", () => { arm(); say(s.dataset.say); });
    s.addEventListener("focus", () => { if (armed) say(s.dataset.say); });
  });
})();
