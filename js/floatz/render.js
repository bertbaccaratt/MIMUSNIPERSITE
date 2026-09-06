/* MIMU Floatz renderer — manga ink pond on paper. Scales 2 → 75 lanes. */
window.FloatzRender = (() => {
  const INK = "#101010", PAPER = "#f6f5f1", WATER = "#dff1fb", WATER2 = "#bfe3f6";
  const images = {};
  let ready = false;

  function loadSprites(ids) {
    return Promise.all(ids.map(id => new Promise(res => {
      const img = new Image();
      img.onload = () => { images[id] = img; res(); };
      img.onerror = () => { console.warn("sprite missing", id); res(); };
      img.src = FloatzEngine.spriteUrl(id);
    }))).then(() => { ready = true; });
  }

  function layout(w, laneCount) {
    const spriteH = laneCount <= 3 ? 110 : laneCount <= 6 ? 96 : laneCount <= 10 ? 84 : laneCount <= 16 ? 70 : laneCount <= 24 ? 58 : laneCount <= 36 ? 48 : laneCount <= 50 ? 42 : 36;
    const spacing = spriteH * (laneCount <= 10 ? 0.82 : laneCount <= 50 ? 0.72 : 0.66);
    const skyH = laneCount <= 8 ? Math.max(90, w * 0.14) : 70;
    const h = Math.ceil(skyH + spacing * laneCount + spriteH * 0.9);
    return { w, h, spriteH, spacing, waterTop: skyH, startX: w * 0.07, finishX: w * 0.9 };
  }

  function makeScene(canvas, roster, script, laneCount) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const L = layout(w, laneCount);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = L.w * dpr; canvas.height = L.h * dpr;
    canvas.style.width = L.w + "px"; canvas.style.height = L.h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const trackLen = L.finishX - L.startX;
    const racers = roster.map((r, i) => ({
      ...r, i,
      laneY: L.waterTop + L.spacing * ((script ? script.laneOrder[i] : i) + 0.95),
      progress: script ? script.start : 0.06, display: script ? script.start : 0.06,
      bob: script ? script.bob[i] : Math.random() * 6.28, splashes: [], racing: false, back: false,
    }));
    const flow = Array.from({ length: laneCount > 24 ? 22 : 34 }, () => ({
      x: L.startX + Math.random() * trackLen, y: L.waterTop + 10 + Math.random() * (L.h - L.waterTop - 20),
      len: 60 + Math.random() * 120, sp: 140 + Math.random() * 160, ph: Math.random() * 6.28, w: 1 + Math.random() * 1.8,
    }));
    const foam = Array.from({ length: laneCount > 24 ? 10 : 18 }, () => ({
      x: L.startX + Math.random() * trackLen, y: L.waterTop + 10 + Math.random() * (L.h - L.waterTop - 20), r: 2 + Math.random() * 3, sp: 90 + Math.random() * 90, ph: Math.random() * 6.28,
    }));
    return { ctx, ...L, trackLen, racers, flow, foam, time: 0, last: performance.now(), confetti: [], script, laneCount, over: false, leader: -1 };
  }

  function tick(S, tRace /* 0..1 or null before start */) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    S.flow.forEach(f => { f.x -= f.sp * dt; f.ph += dt * 1.6; if (f.x + f.len < S.startX) { f.x = S.finishX + Math.random() * 80; f.y = S.waterTop + 10 + Math.random() * (S.h - S.waterTop - 20); } });
    S.foam.forEach(f => { f.x -= f.sp * dt; f.ph += dt * 2; if (f.x < S.startX - 10) { f.x = S.finishX + Math.random() * 60; } });
    S.racers.forEach(r => {
      if (tRace == null || !S.script) { r.bob += dt * 3; return; }
      const target = FloatzEngine.sample(S.script.trajectories, r.i, tRace);
      const diff = target - r.display, k = 1 - Math.exp(-dt * (Math.abs(diff) > 0.012 ? 22 : 12));
      r.display += diff * k; r.progress = r.display;
      const sp = FloatzEngine.speed(S.script.trajectories, r.i, tRace);
      r.back = sp < -0.015; r.racing = sp > 0.02; r.bob += dt * (4 + Math.abs(sp) * 3);
      if (Math.abs(sp) > 0.008 && Math.random() < (0.15 + Math.min(0.5, Math.abs(sp) * 1.5)) * (S.laneCount > 16 ? 0.4 : 1) * dt * 60)
        r.splashes.push({ x: 0, y: 0, vx: sp >= 0 ? -1 - Math.random() * 2 : 1 + Math.random() * 2, vy: -1 - Math.random() * 2, life: 1, size: 2 + Math.random() * 3, ox: sp >= 0 ? -18 : 14 });
      r.splashes = r.splashes.filter(s => { s.x += s.vx * dt * 60; s.y += s.vy * dt * 60; s.vy += 0.08 * dt * 60; s.life -= 0.04 * dt * 60; return s.life > 0; }).slice(-6);
    });
    if (tRace != null && S.script) {
      const lead = S.racers.reduce((a, b) => (b.display > a.display ? b : a));
      if (S.leader !== -1 && lead.i !== S.leader) lead.bob += 0.8;
      S.leader = lead.i;
    }
    S.confetti.forEach(c => { c.x += c.vx; c.y += c.vy; c.vy += 0.05; c.rot += c.rv; });
    S.confetti = S.confetti.filter(c => c.y < S.h + 20);
  }

  function snapToEnd(S) {
    const last = S.script.trajectories[0].length - 1;
    S.racers.forEach(r => { r.display = r.progress = S.script.trajectories[r.i][last]; });
    S.over = true;
  }

  function confetti(S, epic) {
    const colors = epic ? ["#ffd23f", "#ff8a1f", "#101010", "#ffffff", "#e83cc8"] : ["#2fa8ff", "#ff8a1f", "#e83cc8", "#c8102e", "#101010", "#ffd23f"];
    for (let i = 0; i < (epic ? 260 : 120); i++) S.confetti.push({
      x: Math.random() * S.w, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4,
      rot: Math.random() * 6.28, rv: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
    });
  }

  // ---------- drawing ----------
  function draw(S, hud) {
    const { ctx, w, h } = S;
    ctx.clearRect(0, 0, w, h);
    drawSky(S); drawWater(S); drawFinish(S); drawStart(S);
    // draw back-to-front so lower lanes overlap upper ones
    [...S.racers].sort((a, b) => a.laneY - b.laneY).forEach(r => { drawSplashes(S, r); drawRacer(S, r); });
    const ranked = [...S.racers].sort((a, b) => b.progress - a.progress);
    const tagAll = S.laneCount <= 16;
    ranked.forEach((r, rank) => { if (tagAll || rank < 3 || r.mine) drawTag(S, r, rank + 1); });
    drawConfetti(S);
    if (hud) drawHUD(S, hud);
  }

  function drawSky(S) {
    const { ctx, w, waterTop } = S;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, waterTop);
    // ink speed lines converging on the finish
    ctx.save(); ctx.globalAlpha = 0.14; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) { const y = (i / 26) * waterTop; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, waterTop * 0.5 + (y - waterTop * 0.5) * 0.35); ctx.stroke(); }
    ctx.restore();
    // ink clouds
    ctx.save(); ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.fillStyle = "#fff";
    cloud(ctx, w * 0.18 + Math.sin(S.time * 0.3) * 8, waterTop * 0.42, Math.min(1, waterTop / 110));
    cloud(ctx, w * 0.62 + Math.sin(S.time * 0.2 + 1) * 6, waterTop * 0.3, 0.7 * Math.min(1, waterTop / 110));
    ctx.restore();
    // horizon line
    ctx.fillStyle = INK; ctx.fillRect(0, waterTop - 3, w, 3);
  }
  function cloud(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.beginPath(); [[0, 0, 26], [-26, 8, 20], [26, 6, 22], [-10, -10, 17], [14, -8, 19]].forEach(([cx, cy, r]) => { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, 6.29); });
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  function drawWater(S) {
    const { ctx, w, h, waterTop, startX, finishX } = S;
    const g = ctx.createLinearGradient(0, waterTop, 0, h); g.addColorStop(0, WATER); g.addColorStop(1, WATER2);
    ctx.fillStyle = g; ctx.fillRect(0, waterTop, w, h - waterTop);
    // halftone shading at the bottom (rendered once per scene, cached)
    if (!S.halftone) {
      const c = document.createElement("canvas"); c.width = w; c.height = h; const hc = c.getContext("2d"); hc.fillStyle = INK;
      for (let y = h - 8; y > waterTop + (h - waterTop) * 0.55; y -= 9) { const a = (h - y) / (h - waterTop); for (let x = 4; x < w; x += 9) { hc.beginPath(); hc.arc(x + ((y / 9) | 0) % 2 * 4, y, 1.2 + a * 1.6, 0, 6.29); hc.fill(); } }
      S.halftone = c;
    }
    ctx.save(); ctx.globalAlpha = 0.12; ctx.drawImage(S.halftone, 0, 0, w, h); ctx.restore();
    // lane guides — gently undulating, scrolling against the racers
    ctx.save(); ctx.strokeStyle = INK; ctx.globalAlpha = 0.09; ctx.lineWidth = 1; ctx.setLineDash([10, 12]); ctx.lineDashOffset = S.time * 120;
    S.racers.forEach((r, i) => { const y0 = r.laneY + S.spriteH * 0.3; ctx.beginPath();
      for (let x = startX; x <= finishX; x += 24) { const y = y0 + Math.sin(x * 0.02 + S.time * 3 + i) * 2.2; x === startX ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); });
    ctx.restore();
    // shimmer bands
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = "#fff";
    for (let i = 0; i < 5; i++) { const bw = 160 + i * 40, off = (S.time * (140 + i * 30) + i * 210) % (finishX - startX + bw); const bx = finishX + bw - off, by = waterTop + 26 + i * ((h - waterTop) / 6);
      ctx.beginPath(); ctx.ellipse(bx, by, bw, 9, 0, 0, 6.29); ctx.fill(); }
    ctx.restore();
    // ink current lines with arrowheads (flowing against the racers)
    ctx.save(); ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineCap = "round";
    S.flow.forEach(f => {
      const y = f.y + Math.sin(f.ph) * 3, x2 = f.x - f.len; ctx.globalAlpha = 0.3; ctx.lineWidth = f.w;
      ctx.beginPath(); ctx.moveTo(f.x, y); ctx.quadraticCurveTo(f.x - f.len * 0.5, y + Math.sin(f.ph * 1.3) * 3, x2, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y); ctx.lineTo(x2 + 8, y - 3.5); ctx.lineTo(x2 + 8, y + 3.5); ctx.closePath(); ctx.fill();
    });
    // foam bubbles riding the current
    ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5;
    S.foam.forEach(f => { const y = f.y + Math.sin(f.ph) * 2; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(f.x, y, f.r, 0, 6.29); ctx.fill(); ctx.strokeStyle = INK; ctx.stroke(); });
    ctx.restore();
  }

  function drawFinish(S) {
    const { ctx, finishX, waterTop, h } = S;
    for (let y = waterTop; y < h - 4; y += 10) { ctx.fillStyle = ((y / 10) | 0) % 2 ? INK : "#fff"; ctx.fillRect(finishX - 5, y, 10, 10); }
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(finishX - 5, waterTop, 10, h - 4 - waterTop);
    // pennant
    ctx.fillStyle = "#c8102e"; ctx.beginPath(); ctx.moveTo(finishX + 8, waterTop + 6); ctx.lineTo(finishX + 78, waterTop + 24); ctx.lineTo(finishX + 8, waterTop + 42); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "700 12px Bangers, Impact, sans-serif"; ctx.fillText("FINISH", finishX + 16, waterTop + 29);
  }
  function drawStart(S) {
    const { ctx, startX, waterTop } = S;
    ctx.save(); ctx.translate(startX - 8, waterTop + 8); ctx.transform(1, 0, -0.15, 1, 0, 0);
    ctx.fillStyle = INK; ctx.fillRect(-60, 0, 60, 26); ctx.fillStyle = "#fff"; ctx.font = "700 14px Bangers, Impact, sans-serif"; ctx.fillText("START", -52, 18);
    ctx.restore();
  }

  function drawSplashes(S, r) {
    const { ctx } = S; const x0 = S.startX + r.display * S.trackLen;
    r.splashes.forEach(s => { ctx.fillStyle = `rgba(16,16,16,${s.life * 0.55})`; ctx.beginPath(); ctx.arc(x0 + s.ox + s.x, r.laneY + s.y, s.size * s.life, 0, 6.29); ctx.fill(); });
  }

  function drawRacer(S, r) {
    const { ctx } = S; const img = images[r.spriteId]; if (!img) return;
    const hgt = S.spriteH, wid = img.naturalWidth * (hgt / img.naturalHeight);
    const x = S.startX + r.display * S.trackLen, bob = Math.sin(r.bob) * 3;
    const left = x - wid * 0.4, top = r.laneY - hgt / 2 + bob;
    // shadow ripple
    ctx.save(); ctx.strokeStyle = INK; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, r.laneY + hgt * 0.42, wid * 0.42, hgt * 0.1, 0, 0, 6.29); ctx.stroke(); ctx.restore();
    if (r.racing && !S.over) { ctx.save(); ctx.strokeStyle = INK; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(left - 6 - i * 8, r.laneY - 6 + i * 6); ctx.lineTo(left - 26 - i * 12, r.laneY - 6 + i * 6); ctx.stroke(); } ctx.restore(); }
    if (r.back && !S.over) { ctx.save(); ctx.strokeStyle = "#c8102e"; ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(left + wid * 0.3 + i * 8, r.laneY + 6 + i * 5); ctx.lineTo(left + wid * 0.7 + i * 10, r.laneY + 6 + i * 5); ctx.stroke(); } ctx.restore(); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, left, top, wid, hgt);
    if (S.leader === r.i && !S.over && S.script) { // "!!" burst over the leader
      ctx.save(); ctx.font = `700 ${Math.max(14, hgt * 0.26)}px Bangers, Impact, sans-serif`; ctx.fillStyle = "#ffd23f"; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = "round";
      ctx.strokeText("!!", left + wid * 0.75, top + 4); ctx.fillText("!!", left + wid * 0.75, top + 4); ctx.restore();
    }
  }

  function drawTag(S, r, rank) {
    const { ctx } = S; const x = S.startX + r.display * S.trackLen, bob = Math.sin(r.bob) * 3;
    const lift = S.spriteH * 0.55 + 10, y = r.laneY - lift + bob;
    const size = S.laneCount > 24 ? 10 : S.laneCount > 12 ? 11 : 13;
    ctx.font = `600 ${size}px "Space Grotesk", system-ui, sans-serif`;
    const label = `#${rank} ${r.name}`, tw = ctx.measureText(label).width;
    ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.fillStyle = r.mine ? "#ffd23f" : INK; ctx.fillRect(-tw / 2 - 7, -size - 3, tw + 14, size + 8);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.strokeRect(-tw / 2 - 7, -size - 3, tw + 14, size + 8);
    ctx.fillStyle = r.mine ? INK : "#fff"; ctx.textAlign = "center"; ctx.fillText(label, 0, 0); ctx.restore();
    ctx.textAlign = "left";
  }

  function drawConfetti(S) {
    const { ctx } = S;
    S.confetti.forEach(c => { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore(); });
  }

  function drawHUD(S, hud) {
    const { ctx, w } = S;
    if (hud.timer) { ctx.save(); ctx.font = "700 20px Bangers, Impact, sans-serif"; const tw = ctx.measureText(hud.timer).width + 26;
      ctx.fillStyle = INK; ctx.fillRect(10, 10, tw, 32); ctx.fillStyle = "#ffd23f"; ctx.fillText(hud.timer, 22, 33); ctx.restore(); }
    const standing = [...S.racers].sort((a, b) => b.progress - a.progress).slice(0, 5);
    const medal = ["1ST", "2ND", "3RD", "4TH", "5TH"];
    ctx.save(); ctx.font = "700 12px Bangers, Impact, sans-serif";
    standing.forEach((r, i) => { ctx.fillStyle = i === 0 ? "#ffd23f" : "#fff"; ctx.fillRect(w - 170, 10 + i * 24, 160, 20); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(w - 170, 10 + i * 24, 160, 20);
      ctx.fillStyle = INK; const nm = r.name.length > 12 ? r.name.slice(0, 11) + "…" : r.name; ctx.fillText(`${medal[i]}  ${nm}`, w - 162, 25 + i * 24); });
    ctx.restore();
  }

  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, get ready() { return ready; } };
})();
