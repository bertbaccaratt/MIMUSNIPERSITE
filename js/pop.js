/* Bubble-pop click sound on every button/link. Web Audio, no files. */
(function () {
  let ctx;
  function pop() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      // body: fast pitch drop sine = the "bloop"
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(900 + Math.random() * 200, t);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.13);
      // click transient: tiny burst of filtered noise = the "p"
      const len = Math.floor(ctx.sampleRate * 0.02), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = ctx.createBufferSource(); s.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2500; f.Q.value = 1.2;
      const ng = ctx.createGain(); ng.gain.value = 0.18;
      s.connect(f).connect(ng).connect(ctx.destination); s.start(t);
    } catch (e) {}
  }
  document.addEventListener("pointerdown", e => {
    if (e.target.closest("a, button, [role=button], .btn, .game, .carousel__btn")) pop();
  }, { passive: true });
  window.mimuPop = pop;
})();
