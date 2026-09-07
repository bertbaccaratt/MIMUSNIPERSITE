/* MIMU Hot Potato — MIMUs sit in a ring; a cursed MIMU egg hops between them, faster and faster
   as it cracks, and hatches on whoever is holding it. One hatch per round until one MIMU is left.
   Tickets make a MIMU pass the egg faster (shorter holds). Script = hop list + hatch times, from the seed. */
window.PotatoRender = (() => {
  const K = window.GameKit, INK = K.INK;
  const images = {}; let ready = false;
  const loadSprites = ids => K.loadSprites(ids, images).then(() => { ready = true; });

  function buildScript(p) {
    const el = K.elimScript({ ...p, first: 0.10, last: 0.96, salt: 0x51e9a3 });
    const rng = el.rng, dur = p.durationMs / 1000, w = i => (p.weights && p.weights[i]) || 1;
    const hops = [];                       // {t (0..1), holder}
    let alive = Array.from({ length: p.count }, (_, i) => i), holder = alive[Math.floor(rng.next() * alive.length)], t = 0.02;
    hops.push({ t, holder });
    const rounds = el.order.map((victim, k) => ({ victim, end: el.elimAt[victim], start: k === 0 ? 0.02 : el.elimAt[el.order[k - 1]] }));
    rounds.forEach(r => {
      const len = r.end - r.start;
      while (true) {
        const u = K.clamp((t - r.start) / len, 0, 1);
        let gap = K.lerp(0.9, 0.13, Math.pow(u, 1.6)) / dur;       // seconds → fraction; hops accelerate
        gap /= Math.pow(w(holder), 0.5);                            // ticketed holders pass quicker
        gap *= 0.7 + rng.next() * 0.6;
        if (t + gap >= r.end - 0.25 / dur) break;
        t += gap;
        const others = alive.filter(i => i !== holder);
        holder = others[Math.floor(rng.next() * others.length)];
        hops.push({ t, holder });
      }
      // final hop lands on the victim, then it hatches at r.end
      if (holder !== r.victim) { t = Math.max(t + 0.08 / dur, r.end - 0.22 / dur); holder = r.victim; hops.push({ t, holder }); }
      hops.push({ t: r.end, holder: r.victim, hatch: true });
      alive = alive.filter(i => i !== r.victim);
      t = r.end + 0.6 / dur; holder = alive[Math.floor(rng.next() * alive.length)]; hops.push({ t, holder });
    });
    return { ...el, hops, rounds };
  }
  const placings = (l, sc) => K.elimPlacings(l, sc);

  function makeScene(canvas, roster, script, laneCount) {
    const { ctx, w, h } = K.fitCanvas(canvas, 0.66, 440, 720);
    const n = roster.length, cx = w / 2, cy = h / 2 + 14, rx = w * 0.40, ry = h * 0.36;
    const spriteW = n <= 8 ? 78 : n <= 16 ? 64 : n <= 30 ? 50 : n <= 50 ? 40 : 32;
    const racers = roster.map((r, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return { ...r, i, a, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, out: false, holding: false, progress: 0, jiggle: 0 }; });
    return { ctx, w, h, cx, cy, rx, ry, spriteW, racers, script, laneCount, t: 0, over: false, time: 0, last: performance.now(), egg: { x: cx, y: cy, from: null, to: null, t0: 0, crack: 0 }, hopIdx: -1, flash: null, shake: 0 };
  }
  function stateAt(sc, t) {   // current hop index, round progress (0..1 = cracking), holder
    let idx = 0; while (idx + 1 < sc.hops.length && sc.hops[idx + 1].t <= t) idx++;
    const round = sc.rounds.find(r => t >= r.start && t < r.end) || null;
    const crack = round ? K.clamp((t - round.start) / (round.end - round.start), 0, 1) : 0;
    return { idx, holder: sc.hops[idx].holder, crack, round };
  }
  function apply(S, t) {
    const sc = S.script; if (!sc) return; S.t = t;
    const st = stateAt(sc, t);
    S.racers.forEach(r => { r.out = t >= sc.elimAt[r.i]; r.holding = !r.out && r.i === st.holder; r.progress = r.out ? sc.elimAt[r.i] : 1 + (r.holding ? 0 : 0.1); });
    S.crack = st.crack; S.holder = st.holder;
    return st;
  }
  function tick(S, tRace) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    if (tRace == null || !S.script) { S.egg.x = S.cx; S.egg.y = S.cy; S.racers.forEach(r => { r.jiggle = 0; }); K.stepParticles(S, dt); K.stepConfetti(S); return; }
    const st = apply(S, tRace);
    if (st.idx !== S.hopIdx) {   // a hop (or hatch) happened
      const jumped = Math.abs(st.idx - S.hopIdx) > 6;
      const prev = S.hopIdx >= 0 ? S.racers[S.script.hops[S.hopIdx].holder] : null, cur = S.racers[st.holder];
      S.hopIdx = st.idx;
      if (!jumped) {
        const hop = S.script.hops[st.idx];
        if (hop.hatch) { onHatch(S, cur); } else { K.sfx.tick(1 - S.crack); S.egg.from = prev ? { x: prev.x, y: prev.y } : { x: S.cx, y: S.cy }; S.egg.to = { x: cur.x, y: cur.y }; S.egg.t0 = now; }
      } else { S.egg.from = null; S.egg.x = cur.x; S.egg.y = cur.y; }
    }
    // egg flight (short arc)
    const cur = S.racers[st.holder];
    if (S.egg.from && S.egg.to) { const u = K.clamp((now - S.egg.t0) / 160, 0, 1); S.egg.x = K.lerp(S.egg.from.x, S.egg.to.x, u); S.egg.y = K.lerp(S.egg.from.y, S.egg.to.y, u) - Math.sin(u * Math.PI) * 60; if (u >= 1) S.egg.from = null; }
    else if (cur) { S.egg.x = cur.x; S.egg.y = cur.y; }
    S.racers.forEach(r => { r.jiggle = r.holding ? Math.sin(S.time * (20 + S.crack * 40)) * (2 + S.crack * 6) : 0; });
    if (S.crack > 0.85 && Math.random() < 0.3) K.puff(S, S.egg.x + (Math.random() - 0.5) * 20, S.egg.y - 20, { color: "rgba(232,60,200,", size: 2, vy: -1.5 });
    if (S.shake > 0) S.shake -= dt * 3;
    if (S.flash && now - S.flash.at > 1100) S.flash = null;
    K.stepParticles(S, dt); K.stepConfetti(S);
  }
  function onHatch(S, victim) {
    const x = victim.x, y = victim.y - S.spriteW * 0.3;
    for (let i = 0; i < 40; i++) K.puff(S, x, y, { color: i % 2 ? "rgba(232,60,200," : "rgba(107,63,181,", vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8 - 2, size: 3 + Math.random() * 5, grow: 0.2 });
    for (let i = 0; i < 14; i++) K.puff(S, x, y, { spark: true, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, color: "rgba(255,210,63," });
    K.sfx.boom(); S.shake = 1; S.flash = { at: performance.now(), text: `HATCH! ${K.short(victim.name, 12)} IS OUT`, x, y };
  }
  function rewind(S, t) { S.particles = []; S.flash = null; S.hopIdx = -1; apply(S, t); const cur = S.racers[S.holder]; if (cur) { S.egg.x = cur.x; S.egg.y = cur.y; } S.egg.from = null; }
  function snapToEnd(S) { apply(S, 1); S.over = true; S.egg.from = null; const win = S.racers[S.script.winnerIndex]; if (win) { S.egg.x = win.x; S.egg.y = win.y; } }
  const confetti = (S, epic) => K.confetti(S, epic);

  function drawEgg(ctx, x, y, size, crack, hatched) {
    ctx.save(); ctx.translate(x, y); if (crack > 0.5) ctx.rotate(Math.sin(performance.now() / 40) * 0.12 * (crack - 0.5) * 2);
    ctx.beginPath(); ctx.ellipse(0, 0, size * 0.42, size * 0.55, 0, 0, 6.29); ctx.fillStyle = "#3c1e5a"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = "#e83cc8"; ctx.beginPath(); ctx.moveTo(-size * 0.28, size * 0.05); for (let i = 0; i < 4; i++) { ctx.lineTo(-size * 0.28 + (i + 0.5) * size * 0.14, size * 0.18); ctx.lineTo(-size * 0.28 + (i + 1) * size * 0.14, size * 0.05); } ctx.lineTo(size * 0.28, size * 0.4); ctx.lineTo(-size * 0.28, size * 0.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ff3030"; ctx.beginPath(); ctx.arc(-size * 0.13, -size * 0.15, size * 0.07, 0, 6.29); ctx.arc(size * 0.13, -size * 0.15, size * 0.07, 0, 6.29); ctx.fill();
    // cracks grow with the round
    ctx.strokeStyle = INK; ctx.lineWidth = 2; const cracks = Math.floor(crack * 7);
    for (let i = 0; i < cracks; i++) { const a = i * 1.7, r0 = size * 0.15, r1 = size * 0.45; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 1.3); ctx.lineTo(Math.cos(a + 0.4) * r1 * 0.6, Math.sin(a + 0.4) * r1 * 0.8); ctx.lineTo(Math.cos(a + 0.2) * r1, Math.sin(a + 0.2) * r1 * 1.3); ctx.stroke(); }
    if (crack > 0.7) { ctx.fillStyle = `rgba(255,210,63,${(crack - 0.7) * 2})`; ctx.font = `700 ${size * 0.5}px Bangers, Impact, sans-serif`; ctx.textAlign = "center"; ctx.fillText("!!", 0, -size * 0.7); }
    ctx.restore();
  }
  function draw(S, hudInfo) {
    const { ctx, w, h, cx, cy, rx, ry } = S; ctx.clearRect(0, 0, w, h);
    ctx.save(); if (S.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * S.shake, (Math.random() - 0.5) * 10 * S.shake);
    // campfire circle: orange ground, speed lines when it's getting hot
    ctx.fillStyle = "#ff8a1f"; ctx.fillRect(-20, -20, w + 40, h + 40);
    if (S.crack > 0.5) { ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${(S.crack - 0.5) * 0.5})`; ctx.lineWidth = 2; for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283 + S.time * 0.3; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rx * 1.15, cy + Math.sin(a) * ry * 1.15); ctx.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w); ctx.stroke(); } ctx.restore(); }
    K.halftone(S, 0.1, 1.2, 8);
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * 1.16, ry * 1.22, 0, 0, 6.29); ctx.fillStyle = "#ffb15c"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.5, ry * 0.5, 0, 0, 6.29); ctx.fillStyle = "#c95d2a"; ctx.fill(); ctx.stroke();
    // fire in the middle
    for (let i = 0; i < 5; i++) { const fl = Math.sin(S.time * 9 + i * 2) * 6; ctx.fillStyle = i % 2 ? "#ffd23f" : "#ff4a1f"; ctx.beginPath(); ctx.moveTo(cx - 22 + i * 11, cy + 14); ctx.lineTo(cx - 16 + i * 11, cy - 20 - fl - (i === 2 ? 14 : 0)); ctx.lineTo(cx - 10 + i * 11, cy + 14); ctx.fill(); }
    ctx.fillStyle = "#5a3a1a"; ctx.fillRect(cx - 26, cy + 12, 52, 7); ctx.strokeRect(cx - 26, cy + 12, 52, 7);
    // MIMUs (back row first)
    const order = [...S.racers].sort((a, b) => a.y - b.y);
    order.forEach(r => { const img = images[r.spriteId]; const bob = r.out ? 0 : Math.sin(S.time * 3 + r.i) * 3;
      ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(r.x, r.y + S.spriteW * 0.45, S.spriteW * 0.4, S.spriteW * 0.12, 0, 0, 6.29); ctx.fill();
      K.drawSprite(ctx, img, r.x + r.jiggle, r.y + bob, S.spriteW, { gray: r.out, alpha: r.out ? 0.55 : 1 });
      if (r.holding) { ctx.save(); ctx.strokeStyle = "#e83cc8"; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -S.time * 60; ctx.beginPath(); ctx.arc(r.x, r.y, S.spriteW * 0.62, 0, 6.29); ctx.stroke(); ctx.restore(); }
    });
    // egg
    if (S.script && !S.over) drawEgg(ctx, S.egg.x, S.egg.y - S.spriteW * 0.55, S.spriteW * 0.55, S.crack, false);
    if (S.over) { const win = S.racers[S.script.winnerIndex]; if (win) { ctx.save(); ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(win.x, win.y, S.spriteW * 0.7 + Math.sin(S.time * 6) * 4, 0, 6.29); ctx.stroke(); ctx.restore(); } }
    K.drawParticles(S);
    const tagAll = S.laneCount <= 24;
    S.racers.forEach(r => { if (r.out) { if (tagAll || r.mine) K.tag(ctx, r.x, r.y + S.spriteW * 0.5, "OUT", { size: 10, above: false }); } else if (tagAll || r.mine || r.holding) K.tag(ctx, r.x, r.y - S.spriteW * 0.55 - (r.holding ? S.spriteW * 0.6 : 0), K.short(r.name, 12), { mine: r.mine, size: S.laneCount > 24 ? 10 : 12 }); });
    if (S.flash) K.sfxText(ctx, K.clamp(S.flash.x, 150, w - 150), K.clamp(S.flash.y - 60, 40, h - 30), S.flash.text, { size: 30, color: "#ffd23f" });
    ctx.restore();
    K.drawConfetti(S);
    const alive = S.racers.filter(r => !r.out).length;
    const standing = [...S.racers].sort((a, b) => b.progress - a.progress);
    K.hud(S, hudInfo, standing, { badge: S.script ? `${alive} LEFT · EGG ${Math.round((S.crack || 0) * 100)}% CRACKED` : null });
  }
  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, buildScript, placings, rewind, get ready() { return ready; } };
})();
