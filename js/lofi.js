/* MIMU Sniper theme — upbeat anime-opening / game-show chiptune, generated live with Web Audio.
   Original composition, no audio files. Toggle with #lofiBtn. Remembers preference in localStorage. */
(function () {
  const btn = document.getElementById("lofiBtn");
  const label = document.getElementById("lofiLabel");
  if (!btn) return;

  const VOLUME = 0.045;                 // deliberately quiet — background, not foreground
  const BPM = 152, beat = 60 / BPM, e8 = beat / 2, e16 = beat / 4, bar = beat * 4;

  // C major, anime-standard I–V–vi–IV with a lift at the end. One chord per bar, 8-bar loop.
  const CHORDS = [
    { root: 36, tones: [60, 64, 67] }, // C
    { root: 43, tones: [59, 62, 67] }, // G
    { root: 45, tones: [60, 64, 69] }, // Am
    { root: 41, tones: [60, 65, 69] }, // F
    { root: 36, tones: [60, 64, 67] }, // C
    { root: 43, tones: [59, 62, 67] }, // G
    { root: 45, tones: [60, 64, 69] }, // Am
    { root: 41, tones: [62, 65, 69] }, // F → (G on beat 4)
  ];
  // Lead melody: per bar, 8 slots of 8th notes. [midi, lengthIn8ths]; 0 = rest. Written to be hummable.
  const MELODY = [
    [[76,1],[79,1],[81,1],[79,1],[76,2],[72,1],[74,1]],
    [[76,1],[74,1],[71,1],[74,1],[79,3],[0,1]],
    [[81,1],[79,1],[76,1],[79,1],[81,1],[83,1],[84,2]],
    [[81,1],[79,1],[77,1],[76,1],[74,1],[76,1],[77,1],[79,1]],
    [[79,1],[76,1],[72,1],[76,1],[79,2],[81,1],[79,1]],
    [[83,1],[81,1],[79,1],[81,1],[83,2],[86,2]],
    [[84,1],[83,1],[81,1],[79,1],[76,1],[79,1],[81,2]],
    [[77,1],[79,1],[81,1],[83,1],[84,3],[0,1]],
  ];

  let ctx, master, noise, running = false, timer = null, nextTime = 0, barIdx = 0;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noise = buf;

    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 9000;
    master = ctx.createGain(); master.gain.value = 0;
    lp.connect(comp).connect(master).connect(ctx.destination);
    ctx._bus = lp;
  }

  // --- voices ---
  function pulse(midi, t, dur, vel, type = "square", vib = 0) {
    const f = mtof(midi);
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = type; o2.frequency.value = f; o2.detune.value = 7; // chorus
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.008);
    g.gain.setValueAtTime(vel, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    if (vib) { const l = ctx.createOscillator(); l.frequency.value = 5.5; const lg = ctx.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.detune); lg.connect(o2.detune); l.start(t + 0.08); l.stop(t + dur); }
    o.connect(g); o2.connect(g); g.connect(ctx._bus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.01); o2.stop(t + dur + 0.01);
  }
  function bass(midi, t, dur) {
    const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.02, t + dur);
    o.connect(f).connect(g).connect(ctx._bus); o.start(t); o.stop(t + dur);
  }
  function kick(t) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(ctx._bus); o.start(t); o.stop(t + 0.25);
  }
  function snare(t) {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    s.connect(f).connect(g).connect(ctx._bus); s.start(t); s.stop(t + 0.15);
  }
  function hat(t, open) {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 8000;
    const g = ctx.createGain(); const d = open ? 0.16 : 0.035;
    g.gain.setValueAtTime(open ? 0.12 : 0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f).connect(g).connect(ctx._bus); s.start(t); s.stop(t + d + 0.01);
  }
  function sparkle(t) { // rising arpeggio flourish at the loop turnaround
    [72, 76, 79, 84, 88].forEach((n, i) => pulse(n, t + i * e16, e16 * 1.5, 0.12, "triangle"));
  }

  function scheduleBar(t, idx) {
    const b = idx % 8, chord = CHORDS[b], intro = idx < 8;

    // lead melody (drops out on the first pass so the song "arrives")
    if (!intro) {
      let pos = 0;
      MELODY[b].forEach(([n, len]) => { if (n) pulse(n, t + pos * e8, len * e8 * 0.92, 0.19, "square", 9); pos += len; });
      // harmony a 3rd/4th below on the long notes of the last two bars
      if (b >= 6) MELODY[b].forEach(([n, len], i) => { if (n && len >= 2) { let p = MELODY[b].slice(0, i).reduce((a, x) => a + x[1], 0); pulse(n - 5, t + p * e8, len * e8 * 0.9, 0.08, "square"); } });
    }

    // 16th-note arpeggio bed (chord tones, up-down)
    const arp = [...chord.tones, chord.tones[1] + 12, chord.tones[2], chord.tones[1], chord.tones[0], chord.tones[0] + 12];
    for (let i = 0; i < 16; i++) pulse(arp[i % arp.length], t + i * e16, e16 * 0.8, intro ? 0.11 : 0.07, "triangle");

    // octave-bounce bass, walk-up on bar 8
    for (let i = 0; i < 8; i++) {
      let n = chord.root + (i % 2 ? 12 : 0);
      if (b === 7 && i >= 6) n = 43 + (i - 6) * 0; // G push
      bass(n, t + i * e8, e8 * 0.9);
    }

    // drums: four-on-the-floor with a skip, snare 2 & 4, 8th hats
    kick(t); kick(t + beat); kick(t + beat * 2); kick(t + beat * 3); kick(t + beat * 3.5);
    snare(t + beat); snare(t + beat * 3);
    if (b === 7) { snare(t + beat * 3.5); snare(t + beat * 3.75); }
    for (let i = 0; i < 8; i++) hat(t + i * e8, i % 2 === 1 && (b % 2 === 1) && i === 7);

    if (b === 7) sparkle(t + beat * 3);
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + 0.5) { scheduleBar(nextTime, barIdx++); nextTime += bar; }
  }

  async function start() {
    if (!ctx) init();
    if (ctx.state === "suspended") await ctx.resume();
    nextTime = ctx.currentTime + 0.1; barIdx = 0;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(VOLUME, ctx.currentTime + 1.2);
    scheduler(); timer = setInterval(scheduler, 150);
    running = true; ui();
  }
  function stop() {
    clearInterval(timer); timer = null;
    if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime); master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8); }
    running = false; ui();
  }
  function ui() {
    btn.classList.toggle("is-on", running);
    btn.setAttribute("aria-pressed", String(running));
    label.textContent = running ? "Music on" : "Music off";
    try { localStorage.setItem("mimu-music", running ? "1" : "0"); } catch (e) {}
  }

  btn.addEventListener("click", () => (running ? stop() : start()));

  let pref = "0"; try { pref = localStorage.getItem("mimu-music") || "0"; } catch (e) {}
  if (pref === "1") {
    label.textContent = "Music (click)";
    const once = () => { start(); window.removeEventListener("pointerdown", once); window.removeEventListener("keydown", once); };
    window.addEventListener("pointerdown", once); window.addEventListener("keydown", once);
  }
})();
