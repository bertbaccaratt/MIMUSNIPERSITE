/* NOT MY EGG — MIMUs chill in recliners around a messy living room; a cursed MIMU egg hops between them, faster and faster
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

  const CHAIRS = [["#7a4a2e", "#a06a44"], ["#3f6b3a", "#5b8f55"], ["#6b2d3a", "#96404f"], ["#3a4b7a", "#5468a6"], ["#5a4632", "#7d6448"], ["#4a3a6b", "#6a558f"]];
  function makeScene(canvas, roster, script, laneCount) {
    const { ctx, w, h } = K.fitCanvas(canvas, 0.66, 440, 720);
    const n = roster.length, cx = w / 2, cy = h / 2 + 14, rx = w * 0.40, ry = h * 0.36;
    const spriteW = n <= 8 ? 78 : n <= 16 ? 64 : n <= 30 ? 50 : n <= 50 ? 40 : 32;
    const racers = roster.map((r, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return { ...r, i, a, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, out: false, holding: false, progress: 0, jiggle: 0, chair: CHAIRS[i % CHAIRS.length] }; });
    // deterministic mess so every screen shows the same living room
    let seed = 1234 + n * 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const mess = []; const kinds = ["pizza", "can", "can", "sock", "chips", "paper", "slice", "remote", "can", "bowl", "sock", "paper"];
    for (let k = 0; k < Math.min(26, 10 + n); k++) {
      for (let tries = 0; tries < 20; tries++) {
        const x = 30 + rnd() * (w - 60), y = h * 0.28 + rnd() * (h * 0.7);
        const nearChair = racers.some(r => Math.abs(r.x - x) < spriteW * 0.95 && Math.abs(r.y - y) < spriteW * 1.05);
        const nearTable = Math.abs(x - cx) < rx * 0.5 + 30 && Math.abs(y - cy) < ry * 0.5 + 24;
        if (!nearChair && !nearTable) { mess.push({ kind: kinds[k % kinds.length], x, y, rot: (rnd() - 0.5) * 1.2, v: rnd() }); break; }
      }
    }
    return { ctx, w, h, cx, cy, rx, ry, spriteW, racers, mess, script, laneCount, t: 0, over: false, time: 0, last: performance.now(), egg: { x: cx, y: cy, from: null, to: null, t0: 0, crack: 0 }, hopIdx: -1, flash: null, shake: 0 };
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


  function drawRecliner(ctx, x, y, sw, [c1, c2], out) {
    const cw = sw * 1.45, back = sw * 1.1, seatH = sw * 0.55, arm = sw * 0.22;
    ctx.save(); if (out) ctx.globalAlpha = 0.6; ctx.lineWidth = 3; ctx.strokeStyle = INK;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(x + 4, y + sw * 0.62, cw * 0.62, sw * 0.28, 0, 0, 6.29); ctx.fill();
    // backrest (tall, tufted)
    ctx.fillStyle = c1; rrect(ctx, x - cw / 2 + arm * 0.5, y - back * 0.85, cw - arm, back, sw * 0.18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c2; rrect(ctx, x - cw / 2 + arm * 0.5 + 6, y - back * 0.85 + 6, cw - arm - 12, back * 0.55, sw * 0.14); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)"; [-0.22, 0.22].forEach(k => { ctx.beginPath(); ctx.arc(x + cw * k, y - back * 0.5, 3, 0, 6.29); ctx.fill(); });
    // seat cushion
    ctx.fillStyle = c2; rrect(ctx, x - cw / 2 + arm * 0.6, y + sw * 0.05, cw - arm * 1.2, seatH * 0.8, 8); ctx.fill(); ctx.stroke();
    // armrests
    ctx.fillStyle = c1; rrect(ctx, x - cw / 2, y - sw * 0.25, arm, seatH * 1.2, 7); ctx.fill(); ctx.stroke(); rrect(ctx, x + cw / 2 - arm, y - sw * 0.25, arm, seatH * 1.2, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawFootrest(ctx, x, y, sw, [c1, c2], out) {
    const cw = sw * 1.45, arm = sw * 0.22;
    ctx.save(); if (out) ctx.globalAlpha = 0.6; ctx.lineWidth = 3; ctx.strokeStyle = INK;
    ctx.fillStyle = c1; rrect(ctx, x - cw / 2 + arm * 0.9, y + sw * 0.36, cw - arm * 1.8, sw * 0.3, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c2; rrect(ctx, x - cw / 2 + arm * 0.9 + 5, y + sw * 0.36 + 4, cw - arm * 1.8 - 10, sw * 0.14, 5); ctx.fill();
    ctx.restore();
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); }
  function drawMess(ctx, m, t) {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.rot); ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
    switch (m.kind) {
      case "pizza": ctx.fillStyle = "#d9a466"; rrect(ctx, -30, -22, 60, 44, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#c48a4a"; rrect(ctx, -30, -22, 60, 8, 3); ctx.fill();
        ctx.fillStyle = "#ffb347"; ctx.beginPath(); ctx.arc(0, 4, 17, 0, 6.29); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#c8102e"; [[-6, 0], [6, 2], [0, 10], [-3, -8]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a, b + 2, 3, 0, 6.29); ctx.fill(); });
        ctx.fillStyle = "#d9a466"; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(17, 4); ctx.arc(0, 4, 17, 0, 1.1); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case "slice": ctx.fillStyle = "#ffb347"; ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(14, -10); ctx.lineTo(0, 16); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#d9a466"; ctx.fillRect(-14, -13, 28, 5); ctx.strokeRect(-14, -13, 28, 5); ctx.fillStyle = "#c8102e"; ctx.beginPath(); ctx.arc(-4, -4, 2.5, 0, 6.29); ctx.arc(5, -2, 2.5, 0, 6.29); ctx.fill(); break;
      case "can": ctx.fillStyle = m.v < 0.5 ? "#c8102e" : "#2fa8ff"; rrect(ctx, -7, -12, 14, 24, 3); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#d8d8d8"; ctx.fillRect(-7, -12, 14, 4); ctx.fillRect(-7, 8, 14, 4); ctx.fillStyle = "#fff"; ctx.fillRect(-3, -4, 6, 8); break;
      case "sock": ctx.fillStyle = m.v < 0.5 ? "#eaeaea" : "#ffd23f"; ctx.beginPath(); ctx.moveTo(-6, -16); ctx.lineTo(6, -16); ctx.lineTo(6, 4); ctx.quadraticCurveTo(18, 6, 16, 14); ctx.quadraticCurveTo(2, 18, -6, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#c8102e"; ctx.fillRect(-6, -16, 12, 4); break;
      case "chips": ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.moveTo(-14, -20); ctx.lineTo(14, -20); ctx.lineTo(12, 20); ctx.lineTo(-12, 20); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#c8102e"; ctx.beginPath(); ctx.ellipse(0, 0, 9, 12, 0, 0, 6.29); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "700 9px Poppins, sans-serif"; ctx.textAlign = "center"; ctx.fillText("MIMU", 0, 3); break;
      case "paper": ctx.fillStyle = "#f4f2ec"; ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283, r = 9 + (i % 2) * 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case "remote": ctx.fillStyle = "#333"; rrect(ctx, -6, -18, 12, 36, 3); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#c8102e"; ctx.beginPath(); ctx.arc(0, -12, 2.5, 0, 6.29); ctx.fill(); ctx.fillStyle = "#aaa"; for (let i = 0; i < 4; i++) ctx.fillRect(-3, -4 + i * 5, 6, 2.5); break;
      case "bowl": ctx.fillStyle = "#2fa8ff"; ctx.beginPath(); ctx.ellipse(0, 0, 22, 12, 0, 0, 6.29); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#fff8dc"; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(-14 + i * 3.5, -4 + ((i * 7) % 5) - 2, 3.5, 0, 6.29); ctx.fill(); } break;
    }
    ctx.restore();
  }
  function drawRoom(S) {
    const { ctx, w, h, cx, cy, rx, ry } = S;
    // wall + baseboard, then a shaggy rug on a wood floor
    ctx.fillStyle = "#f0d9a6"; ctx.fillRect(-20, -20, w + 40, h * 0.3 + 20);
    ctx.fillStyle = "rgba(0,0,0,0.06)"; for (let x = 0; x < w; x += 28) ctx.fillRect(x, -20, 10, h * 0.3 + 20);
    ctx.fillStyle = "#a9743f"; ctx.fillRect(-20, h * 0.3, w + 40, h); ctx.fillStyle = "rgba(0,0,0,0.12)"; for (let y = h * 0.3; y < h; y += 26) ctx.fillRect(-20, y, w + 40, 2);
    ctx.fillStyle = "#f7efe1"; ctx.fillRect(-20, h * 0.3 - 10, w + 40, 10); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(-20, h * 0.3 - 10, w + 40, 10);
    // window + poster + TV on the wall
    ctx.fillStyle = "#8fd3ff"; rrect(ctx, w * 0.62, 18, w * 0.2, h * 0.19, 4); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w * 0.72, 18); ctx.lineTo(w * 0.72, 18 + h * 0.19); ctx.moveTo(w * 0.62, 18 + h * 0.095); ctx.lineTo(w * 0.82, 18 + h * 0.095); ctx.stroke();
    ctx.fillStyle = "#1a1a24"; ctx.beginPath(); ctx.arc(w * 0.66, 18 + h * 0.06, 6, 0, 6.29); ctx.fill();   // moon
    ctx.fillStyle = "#e83cc8"; rrect(ctx, w * 0.16, 22, w * 0.13, h * 0.17, 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "700 11px Poppins, sans-serif"; ctx.textAlign = "center"; ctx.fillText("WITNESS", w * 0.225, 30 + h * 0.07); ctx.fillText("THEM", w * 0.225, 44 + h * 0.07);
    ctx.fillStyle = "#222"; rrect(ctx, w * 0.36, 26, w * 0.24, h * 0.17, 6); ctx.fill(); ctx.stroke();
    const tv = Math.sin(S.time * 8) * 0.5 + 0.5; ctx.fillStyle = `rgb(${40 + tv * 30},${80 + tv * 60},${140 + tv * 60})`; ctx.fillRect(w * 0.37, 32, w * 0.22, h * 0.17 - 12);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; for (let i = 0; i < 6; i++) ctx.fillRect(w * 0.37, 32 + ((S.time * 40 + i * 17) % (h * 0.17 - 12)), w * 0.22, 2);
    ctx.fillStyle = "#444"; ctx.fillRect(w * 0.46, 26 + h * 0.17, w * 0.04, 8);
    // rug
    ctx.fillStyle = "#6b3fb5"; ctx.beginPath(); ctx.ellipse(cx, cy + 10, rx * 1.28, ry * 1.34, 0, 0, 6.29); ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = "#e83cc8"; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.ellipse(cx, cy + 10, rx * 1.15, ry * 1.2, 0, 0, 6.29); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = INK;
    K.halftone(S, 0.08, 1.2, 9);
    // coffee table with the mess of the century
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(cx + 4, cy + 10, rx * 0.5, ry * 0.42, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = "#c9925a"; ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.5, ry * 0.4, 0, 0, 6.29); ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#a9743f"; ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.42, ry * 0.32, 0, 0, 6.29); ctx.fill();
    drawMess(ctx, { kind: "pizza", x: cx - rx * 0.22, y: cy - 4, rot: -0.2, v: 0.2 }, 0); drawMess(ctx, { kind: "can", x: cx + rx * 0.18, y: cy - 12, rot: 0.3, v: 0.3 }, 0);
    drawMess(ctx, { kind: "can", x: cx + rx * 0.3, y: cy + 8, rot: -1.2, v: 0.7 }, 0); drawMess(ctx, { kind: "remote", x: cx + rx * 0.05, y: cy + 14, rot: 0.9, v: 0 }, 0); drawMess(ctx, { kind: "slice", x: cx - rx * 0.02, y: cy - 16, rot: 2.4, v: 0 }, 0);
    S.mess.forEach(m => drawMess(ctx, m, S.time));
    // when the egg's about to blow the lights flicker red
    if (S.crack > 0.6) { ctx.fillStyle = `rgba(232,60,60,${(S.crack - 0.6) * 0.35 * (0.6 + 0.4 * Math.sin(S.time * 12))})`; ctx.fillRect(-20, -20, w + 40, h + 40); }
  }
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
    drawRoom(S);
    // MIMUs in their recliners (back row first)
    const order = [...S.racers].sort((a, b) => a.y - b.y);
    order.forEach(r => { const img = images[r.spriteId]; const bob = r.out ? 0 : Math.sin(S.time * 3 + r.i) * 2;
      drawRecliner(ctx, r.x, r.y, S.spriteW, r.chair, r.out);
      K.drawSprite(ctx, img, r.x + r.jiggle, r.y + bob - S.spriteW * 0.08, S.spriteW * 0.92, { gray: r.out, alpha: r.out ? 0.55 : 1 });
      drawFootrest(ctx, r.x, r.y, S.spriteW, r.chair, r.out);
      if (r.holding) { ctx.save(); ctx.strokeStyle = "#e83cc8"; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -S.time * 60; ctx.beginPath(); ctx.arc(r.x, r.y, S.spriteW * 0.72, 0, 6.29); ctx.stroke(); ctx.restore(); }
    });
    // egg
    if (S.script && !S.over) drawEgg(ctx, S.egg.x, S.egg.y - S.spriteW * 0.62, S.spriteW * 0.5, S.crack, false);
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
