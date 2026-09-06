/* MIMU Wheel — everyone watches, the booth loads names and spins.
   State lives in Store("wheel"); every screen derives the wheel angle from the clock,
   so phones, laptops and the projector all show the same spin. */
(() => {
  const ADMIN_PASSWORD = "5555WENUMIM";          // same passphrase as the float race booth
  const COUNTDOWN_MS = 3000;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const assetUrl = p => (window.__SPRITE_DATA && window.__SPRITE_DATA[p]) || p;
  const PALETTE = ["#2fa8ff", "#ff8a1f", "#6b3fb5", "#c8102e", "#ffd23f", "#28c8a0"];
  const INK = "#101010", PAPER = "#f6f5f1";

  /* ---------- sound ---------- */
  const sfx = (() => {
    let ctx; const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    const tone = (f, t0, dur, type = "square", vol = 0.12, slide = 0) => {
      const c = ac(), o = c.createOscillator(), g = c.createGain(); o.type = type;
      o.frequency.setValueAtTime(f, c.currentTime + t0); if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + t0 + dur);
      g.gain.setValueAtTime(vol, c.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
      o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.02);
    };
    let noiseBuf;
    const noise = () => { const c = ac(); if (noiseBuf) return noiseBuf; noiseBuf = c.createBuffer(1, c.sampleRate * 0.1, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf; };
    return {
      resume: () => { if (ctx?.state === "suspended") ctx.resume(); },
      tick(speed) {   // wheel peg click — sharper + louder as it slows
        const c = ac(), s = c.createBufferSource(); s.buffer = noise();
        const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800 + speed * 600; f.Q.value = 1.2;
        const g = c.createGain(); const v = Math.min(0.5, 0.12 + (1 - speed) * 0.4); g.gain.setValueAtTime(v, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.045);
        s.connect(f).connect(g).connect(c.destination); s.start();
      },
      whoosh() { tone(120, 0, 1.6, "sawtooth", 0.06, 900); },
      beep() { tone(880, 0, 0.12, "square", 0.1); },
      fanfare() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, i === 6 ? 0.7 : 0.16, "square", 0.11)); tone(65, 0, 0.9, "triangle", 0.2); },
      _load(n) {
        const c = ac(); const url = assetUrl(`assets/sfx/cd${n}.mp3`);
        const bytes = url.startsWith("data:") ? Promise.resolve(Uint8Array.from(atob(url.split(",")[1]), ch => ch.charCodeAt(0)).buffer) : fetch(url).then(r => r.arrayBuffer());
        return bytes.then(b => c.decodeAudioData(b)).then(buf => ((this._clips ||= {})[n] = buf));
      },
      announce(n) {   // Holden through the stadium echo (same chain as the race)
        const c = ac();
        const play = buf => {
          const t = c.currentTime + 0.02, src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = 0.94;
          const dry = c.createGain(); dry.gain.value = 0.9; const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
          const d1 = c.createDelay(1); d1.delayTime.value = 0.16; const f1 = c.createGain(); f1.gain.value = 0.42;
          const d2 = c.createDelay(1); d2.delayTime.value = 0.31; const f2 = c.createGain(); f2.gain.value = 0.3;
          const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600; const wet = c.createGain(); wet.gain.value = 0.55;
          src.connect(dry).connect(comp); src.connect(d1); d1.connect(f1); f1.connect(lp); f1.connect(d1); src.connect(d2); d2.connect(f2); f2.connect(lp); f2.connect(d2);
          lp.connect(wet).connect(comp); comp.connect(c.destination); src.start(t);
        };
        if (this._clips?.[n]) return play(this._clips[n]);
        this._load(n).then(play).catch(() => this.beep());
      },
      preload() { [3, 2, 1, 0].forEach(n => this._load(n).catch(() => {})); },
    };
  })();

  /* ---------- spin maths (pure functions of state + time) ---------- */
  // velocity profile over u∈[0,1]: ramp up → full send → long dramatic decel
  const RAMP = 0.06;
  const decelLen = D => Math.max(0.2, Math.min(0.45, 25000 / D));
  function profile(D) {
    const dec = decelLen(D), plateau = 1 - RAMP - dec;
    const I = RAMP / 2 + plateau + dec / 3;                    // ∫v du
    const pos = u => {                                          // ∫0^u v
      if (u <= 0) return 0;
      if (u < RAMP) { const s = u / RAMP; return RAMP * (s * s * s - s * s * s * s / 2); }   // ∫ smoothstep-ish (3s²-2s³)
      if (u < RAMP + plateau) return RAMP / 2 + (u - RAMP);
      if (u >= 1) return I;
      const s = (u - RAMP - plateau) / dec; return RAMP / 2 + plateau + dec * (1 - Math.pow(1 - s, 3)) / 3;
    };
    const vel = u => { if (u <= 0 || u >= 1) return 0; if (u < RAMP) { const s = u / RAMP; return 3 * s * s - 2 * s * s * s; } if (u < RAMP + plateau) return 1; const s = (u - RAMP - plateau) / dec; return (1 - s) * (1 - s); };
    return { I, pos, vel, dec, plateau };
  }
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function planSpin(s) {   // total angle so the pointer lands on winnerIndex
    const n = s.names.length, seg = (Math.PI * 2) / n, rnd = seeded(s.seed);
    const turns = Math.round(s.durationMs / 1000 * 1.1);
    const jitter = (rnd() - 0.5) * seg * 0.7;                    // anywhere inside the slice, not dead-centre
    const theta = Math.PI * 2 * turns + (Math.PI * 2 - (s.winnerIndex + 0.5) * seg) + jitter;
    return { theta, seg, ...profile(s.durationMs) };
  }
  function angleAt(s, now) {   // rotation (radians, clockwise) and normalised speed at time `now`
    const p = planSpin(s), u = (now - s.spinStartAt) / s.durationMs;
    if (u <= 0) return { theta: 0, speed: 0, u: 0, p };
    if (u >= 1) return { theta: p.theta, speed: 0, u: 1, p };
    return { theta: p.theta * p.pos(u) / p.I, speed: p.vel(u), u, p };
  }
  const segUnderPointer = (theta, n) => { const seg = Math.PI * 2 / n; const local = ((-theta) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); return Math.floor(local / seg) % n; };

  /* ---------- state ---------- */
  Store.normalize("wheel", s => s ? { names: [], history: [], ...s, names: Array.isArray(s.names) ? s.names : Object.values(s.names || {}), history: Array.isArray(s.history) ? s.history : Object.values(s.history || {}) } : null);
  const fresh = () => ({ id: "W" + Store.now().toString(36), names: [], status: "idle", durationMs: 60000, removeWinner: true, history: [], spinStartAt: 0, winnerIndex: -1, seed: 0 });
  let state = null, isAdmin = false, lastSeg = -1, lastCd = -1, shownResultFor = null, restTheta = 0;
  const phaseOf = (s, now) => s.status !== "spinning" ? s.status : now < s.spinStartAt ? "countdown" : now < s.spinStartAt + s.durationMs ? "spinning" : "done";

  /* ---------- canvas ---------- */
  const canvas = $("wheel-canvas"), ctx = canvas.getContext("2d");
    const ghost = [];   // recent angles for motion blur
  let confetti = [], lightsPhase = 0, lastFrame = performance.now();

  function fit() { const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); const s = Math.round(r.width * dpr) || 720; if (canvas.width !== s) { canvas.width = canvas.height = s; } }
  function drawWheel(theta, speed, names, hot) {
    fit();
    const S = canvas.width, c = S / 2, R = S * 0.44, n = Math.max(names.length, 1), seg = Math.PI * 2 / n;
    ctx.clearRect(0, 0, S, S);
    // motion-blur ghosts while fast
    if (speed > 0.35) { ghost.push(theta); if (ghost.length > 4) ghost.shift(); } else ghost.length = 0;
    const paint = (th, alpha) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(c, c); ctx.rotate(th);
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
        let col = PALETTE[i % PALETTE.length]; if (n % PALETTE.length === 1 && i === n - 1) col = PALETTE[2];
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath();
        ctx.fillStyle = names.length ? col : "#e9e7e0"; ctx.fill();
        ctx.lineWidth = S * 0.006; ctx.strokeStyle = INK; ctx.stroke();
        if (hot === i && alpha === 1) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill(); }
        // halftone accent near the rim
        if (n <= 40) { ctx.fillStyle = "rgba(255,255,255,0.75)"; for (let k = 0; k < 3; k++) { const rr = R * (0.86 + k * 0.045), am = a0 + seg / 2 + (k - 1) * seg * 0.22; ctx.beginPath(); ctx.arc(Math.cos(am) * rr, Math.sin(am) * rr, S * 0.006, 0, Math.PI * 2); ctx.fill(); } }
        // name
        if (names.length) {
          ctx.save(); ctx.rotate(a0 + seg / 2);
          const fs = Math.max(S * 0.014, Math.min(S * 0.05, (seg * R * 0.62) / 1.05));
          ctx.font = `${fs}px Bangers, Impact, sans-serif`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
          let label = names[i].name; const maxW = R * 0.6; while (ctx.measureText(label).width > maxW && label.length > 3) label = label.slice(0, -2) + "…";
          ctx.lineWidth = fs * 0.16; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.strokeText(label, R * 0.82, 0);
          ctx.fillStyle = (col === "#ffd23f" || col === "#28c8a0") ? INK : "#fff"; ctx.fillText(label, R * 0.82, 0);
          ctx.restore();
        }
      }
      ctx.restore();
    };
    ghost.forEach((g, i) => paint(g, 0.12 + i * 0.06));
    paint(theta, 1);
    // rim + chasing lights
    ctx.save(); ctx.translate(c, c);
    ctx.beginPath(); ctx.arc(0, 0, R + S * 0.03, 0, Math.PI * 2); ctx.lineWidth = S * 0.02; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R + S * 0.03, 0, Math.PI * 2); ctx.lineWidth = S * 0.011; ctx.strokeStyle = "#ffd23f"; ctx.stroke();
    const L = 36; for (let i = 0; i < L; i++) { const a = i * Math.PI * 2 / L; const on = ((i + Math.floor(lightsPhase)) % 3) === 0; ctx.beginPath(); ctx.arc(Math.cos(a) * (R + S * 0.03), Math.sin(a) * (R + S * 0.03), S * 0.008, 0, Math.PI * 2); ctx.fillStyle = on ? "#fff" : (speed > 0 ? "#c8102e" : "#101010"); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke(); }
    // hub
    ctx.beginPath(); ctx.arc(0, 0, R * 0.2, 0, Math.PI * 2); ctx.fillStyle = PAPER; ctx.fill(); ctx.lineWidth = S * 0.01; ctx.strokeStyle = INK; ctx.stroke();
    { ctx.save(); ctx.rotate(theta * 0.5 + Math.sin(performance.now() / 600) * 0.08); ctx.beginPath(); for (let k = 0; k < 10; k++) { const rr = k % 2 ? R * 0.055 : R * 0.13, a = -Math.PI / 2 + k * Math.PI / 5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fillStyle = "#ffd23f"; ctx.fill(); ctx.lineWidth = S * 0.006; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore(); }
    // confetti
    confetti.forEach(p => { ctx.save(); ctx.translate(p.x - c, p.y - c); ctx.rotate(p.r); ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    ctx.restore();
  }
  function burstConfetti() { const S = canvas.width; confetti = Array.from({ length: 160 }, () => ({ x: S / 2, y: S / 2, vx: (Math.random() - 0.5) * S * 0.03, vy: (Math.random() - 0.9) * S * 0.03, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, s: S * (0.012 + Math.random() * 0.014), col: PALETTE[Math.floor(Math.random() * PALETTE.length)] })); }
  function stepConfetti(dt) { const S = canvas.width; confetti.forEach(p => { p.vy += S * 0.0009 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; }); confetti = confetti.filter(p => p.y < S * 1.2); }

  /* ---------- render loop ---------- */
  function caption(phase, u, p) {
    if (phase === "idle") return state.names.length < 2 ? "Waiting for the booth to load the wheel…" : `${state.names.length} names on the wheel — waiting for the booth`;
    if (phase === "countdown") return "HOLD ON TO SOMETHING";
    if (phase === "done") return "THE WHEEL HAS SPOKEN";
    if (u < RAMP) return "REV IT UP";
    if (u < RAMP + p.plateau) return "FULL SEND!!";
    const s = (u - RAMP - p.plateau) / p.dec;
    return s < 0.5 ? "LOSING STEAM…" : s < 0.85 ? "WHO'S IT GONNA BE" : "ANY SECOND NOW";
  }
  function frame(now) {
    const dt = Math.min(3, (now - lastFrame) / 16.7); lastFrame = now;
    if (!state) { requestAnimationFrame(frame); return; }
    const wall = Store.now(), phase = phaseOf(state, wall), n = state.names.length;
    let theta = restTheta, speed = 0, u = 0, p = null;
    if (state.status === "spinning" && n) { const a = angleAt(state, wall); theta = a.theta; speed = a.speed; u = a.u; p = a.p; }
    const hot = n ? segUnderPointer(theta, n) : -1;
    lightsPhase += (0.05 + speed * 0.6) * dt;
    stepConfetti(dt);
    drawWheel(theta, speed, state.names, hot);

    // pegs: tick when the pointer crosses a slice
    if (hot !== lastSeg && n) {
      if (phase === "spinning") { sfx.tick(speed); $("wheel-pointer").classList.remove("is-flick"); void $("wheel-pointer").offsetWidth; $("wheel-pointer").classList.add("is-flick"); if (speed < 0.12) { $("wheel-stage").classList.remove("is-shake"); void $("wheel-stage").offsetWidth; $("wheel-stage").classList.add("is-shake"); } }
      $("wheel-now-name").textContent = state.names[hot]?.name || "—"; $("wheel-now").classList.remove("is-pop"); void $("wheel-now").offsetWidth; $("wheel-now").classList.add("is-pop");
      lastSeg = hot;
    }
    if (!n) $("wheel-now-name").textContent = "—";
    $("wheel-now").classList.toggle("is-hot", phase === "spinning" && u > RAMP + (p?.plateau || 0));
    // burst lines + captions
    const burst = $("wheel-burst"); burst.classList.toggle("is-on", speed > 0.25); burst.classList.toggle("is-fast", speed > 0.8);
    const cap = $("wheel-caption"), text = caption(phase, u, p); if (cap.textContent !== text) cap.textContent = text;
    cap.classList.toggle("is-hype", phase === "spinning" && speed >= 0.99); cap.classList.toggle("is-tense", phase === "spinning" && u > 0.9);
    const pill = $("wheel-state"); pill.dataset.state = phase; pill.textContent = { idle: "READY", countdown: "COUNTDOWN", spinning: "SPINNING", done: "WINNER" }[phase];

    // 3-2-1 with the announcer
    const cd = $("countdown");
    if (phase === "countdown") { const sec = Math.ceil((state.spinStartAt - wall) / 1000); cd.classList.remove("hidden"); $("countdown-num").textContent = sec > 0 ? sec : "GO!"; if (sec !== lastCd) { if (sec > 0 && sec <= 3) sfx.announce(sec); lastCd = sec; } }
    else { if (lastCd !== -1 && phase === "spinning" && lastCd !== 0) { sfx.announce(0); sfx.whoosh(); lastCd = 0; } if (phase !== "countdown") { cd.classList.add("hidden"); if (phase !== "spinning") lastCd = -1; } }

    // finish — show the card first (names still intact), then let the booth close the spin
    if (phase === "done" && state.status === "spinning") { restTheta = theta; if (n && shownResultFor !== state.spinStartAt) showResult(state.names[state.winnerIndex]?.name, state.spinStartAt, state.names.length, state.durationMs, state.seed); if (isAdmin) finishSpin(); }
    const lr = state.lastResult; if (lr && shownResultFor !== lr.spinStartAt && Store.now() - lr.at < 90000) showResult(lr.name, lr.spinStartAt, lr.count, lr.durationMs, lr.seed);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- views ---------- */
  function renderLists() {
    const s = state; $("wheel-count").textContent = `${s.names.length}`;
    $("wheel-names").innerHTML = s.names.map((r, i) => `<li class="${isAdmin ? "is-admin" : ""}" data-id="${r.id}" title="${isAdmin ? "Remove" : ""}"><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(r.name)}</li>`).join("") || `<li class="empty">No names yet${isAdmin ? " — add some below." : "."}</li>`;
    $("wheel-history").innerHTML = (s.history || []).slice(0, 12).map(h => `<li><b>${esc(h.name)}</b><span>${new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></li>`).join("") || `<li class="empty">Nobody yet. Spin it.</li>`;
    if (isAdmin) { $("admin-duration").value = String(s.durationMs); $("admin-remove-winner").checked = !!s.removeWinner; const busy = s.status === "spinning"; $("admin-spin").disabled = busy || s.names.length < 2; $("admin-hint").textContent = s.names.length < 2 ? "Add at least 2 names to spin." : busy ? "Spinning… hit Reset spin to abort." : `${s.names.length} names · ${s.durationMs / 60000} minute spin`; }
  }
  function showResult(name, key, count, durationMs, seed) {
    shownResultFor = key; if (!name) return;
    burstConfetti(); sfx.fanfare();
    $("result-name").textContent = `${name}!`; $("result-sub").textContent = `${count} names · ${durationMs / 60000} min spin · seed ${(seed || 0).toString(16)}`;
    $("wheel-result").classList.remove("hidden");
  }
  function onState(s) {
    if (!s) { if (isAdmin) Store.set("wheel", fresh()); state = fresh(); } else state = s;
    if (state.status !== "spinning") restTheta = state.restTheta || 0;
    renderLists();
  }

  /* ---------- admin ---------- */
  const update = fn => Store.update("wheel", cur => fn({ ...(cur || fresh()) }));
  function addNames(text) {
    const list = text.split(/\r?\n|,/).map(t => t.trim().slice(0, 24)).filter(Boolean); if (!list.length) return;
    update(s => { const names = [...s.names]; list.forEach(n => { if (!names.some(x => x.name.toLowerCase() === n.toLowerCase())) names.push({ id: "n" + Math.random().toString(36).slice(2, 8), name: n }); }); return { ...s, names }; });
  }
  function spin() {
    update(s => { if (s.names.length < 2 || s.status === "spinning") return s;
      const seed = (Math.random() * 0xffffffff) >>> 0, winnerIndex = Math.floor(Math.random() * s.names.length);
      return { ...s, status: "spinning", spinStartAt: Store.now() + COUNTDOWN_MS, durationMs: parseInt($("admin-duration").value, 10) || 60000, removeWinner: $("admin-remove-winner").checked, seed, winnerIndex }; });
    lastCd = -1;
  }
  function finishSpin() {
    update(s => { if (s.status !== "spinning") return s; const w = s.names[s.winnerIndex]; const a = angleAt(s, s.spinStartAt + s.durationMs);
      const history = [{ name: w?.name || "?", at: Store.now() }, ...(s.history || [])].slice(0, 50);
      const names = s.removeWinner ? s.names.filter((_, i) => i !== s.winnerIndex) : s.names;
      return { ...s, status: "idle", history, names, restTheta: a.theta % (Math.PI * 2), lastResult: { name: w?.name || "?", spinStartAt: s.spinStartAt, at: Store.now(), count: s.names.length, durationMs: s.durationMs, seed: s.seed } }; });
  }
  function bind() {
    $("go-admin").addEventListener("click", () => { if (isAdmin) { $("admin").classList.remove("hidden"); $("admin").scrollIntoView({ behavior: "smooth" }); } else { $("gate").classList.remove("hidden"); $("gate-pass").focus(); } });
    $("gate-cancel").addEventListener("click", () => $("gate").classList.add("hidden"));
    const tryGate = () => { if ($("gate-pass").value === ADMIN_PASSWORD) { $("gate").classList.add("hidden"); isAdmin = true; $("admin").classList.remove("hidden"); $("go-admin").querySelector("span").textContent = "Admin panel"; onState(Store.get("wheel")); $("admin").scrollIntoView({ behavior: "smooth" }); } else $("gate-err").classList.remove("hidden"); };
    $("gate-go").addEventListener("click", tryGate); $("gate-pass").addEventListener("keydown", e => e.key === "Enter" && tryGate());
    $("admin-hide").addEventListener("click", () => $("admin").classList.add("hidden"));
    $("admin-add").addEventListener("click", () => { addNames($("admin-names").value); $("admin-names").value = ""; });
    $("admin-names").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("admin-add").click(); });
    $("admin-clear").addEventListener("click", () => { if (confirm("Clear every name off the wheel?")) update(s => ({ ...s, names: [], status: "idle" })); });
    $("admin-clear-history").addEventListener("click", () => update(s => ({ ...s, history: [] })));
    $("admin-duration").addEventListener("change", () => update(s => ({ ...s, durationMs: parseInt($("admin-duration").value, 10) })));
    $("admin-remove-winner").addEventListener("change", () => update(s => ({ ...s, removeWinner: $("admin-remove-winner").checked })));
    $("admin-spin").addEventListener("click", () => { sfx.resume(); spin(); });
    $("admin-stop").addEventListener("click", () => update(s => ({ ...s, status: "idle", winnerIndex: -1, lastResult: null })));
    $("wheel-names").addEventListener("click", e => { const li = e.target.closest("li[data-id]"); if (!li || !isAdmin || state.status === "spinning") return; update(s => ({ ...s, names: s.names.filter(n => n.id !== li.dataset.id) })); });
    $("result-close").addEventListener("click", () => $("wheel-result").classList.add("hidden"));
    document.addEventListener("pointerdown", () => { sfx.resume(); sfx.preload(); }, { once: true });
    window.addEventListener("resize", fit);
  }

  bind();
  Store.preload(["wheel"]).then(() => Store.subscribe("wheel", onState));
})();
