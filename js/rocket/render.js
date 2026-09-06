/* Rocket MIMU renderer — same API as FloatzRender, but the track is vertical:
   lanes are columns, launchpad at the bottom, finish line up in the stars. Scales 2 → 75 lanes. */
window.RocketRender = (() => {
  const INK = "#101010", PAPER = "#f6f5f1", SPACE = "#1b1d3a", SPACE2 = "#3b2a6b", DUSK = "#c95d9a";
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
    const padX = w * 0.05, spacing = (w - padX * 2) / laneCount;
    const spriteW = Math.max(14, Math.min(laneCount <= 6 ? 104 : laneCount <= 12 ? 84 : 74, spacing * 0.92));
    const spriteH = spriteW * 1.34;
    const h = Math.max(420, Math.min(720, Math.round(w * 0.62)));
    const padTop = 70, padBottom = 70 + spriteH * 0.5;
    return { w, h, spriteW, spriteH, spacing, padX, finishY: padTop, startY: h - padBottom };
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
    const trackLen = L.startY - L.finishY;
    const racers = roster.map((r, i) => ({
      ...r, i,
      laneX: L.padX + L.spacing * ((script ? script.laneOrder[i] : i) + 0.5),
      progress: script ? script.start : 0.04, display: script ? script.start : 0.04,
      bob: script ? script.bob[i] : Math.random() * 6.28, splashes: [], racing: false, back: false,
    }));
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random() * w, y: Math.random() * L.h, r: 0.6 + Math.random() * 1.6, ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 1.5 }));
    const streaks = Array.from({ length: laneCount > 24 ? 16 : 26 }, () => ({ x: Math.random() * w, y: Math.random() * L.h, len: 40 + Math.random() * 110, sp: 160 + Math.random() * 220, w: 1 + Math.random() * 1.6 }));
    return { ctx, ...L, trackLen, racers, stars, streaks, time: 0, last: performance.now(), confetti: [], script, laneCount, over: false, leader: -1 };
  }

  function tick(S, tRace) {
    const now = performance.now(), dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.time += dt;
    const racing = tRace != null && S.script && !S.over;
    S.stars.forEach(s => { s.ph += dt * s.sp; if (racing) { s.y += dt * 40 * s.sp; if (s.y > S.h) { s.y = -4; s.x = Math.random() * S.w; } } });
    S.streaks.forEach(f => { f.y += f.sp * dt * (racing ? 1 : 0.25); if (f.y - f.len > S.h) { f.y = -Math.random() * 80; f.x = Math.random() * S.w; } });
    S.racers.forEach(r => {
      if (tRace == null || !S.script) { r.bob += dt * 3; return; }
      const target = FloatzEngine.sample(S.script.trajectories, r.i, tRace);
      const diff = target - r.display, k = 1 - Math.exp(-dt * (Math.abs(diff) > 0.012 ? 22 : 12));
      r.display += diff * k; r.progress = r.display;
      const sp = FloatzEngine.speed(S.script.trajectories, r.i, tRace);
      r.back = sp < -0.015; r.racing = sp > 0.02; r.bob += dt * (6 + Math.abs(sp) * 4);
      // exhaust puffs
      if (Math.abs(sp) > 0.008 && Math.random() < (0.25 + Math.min(0.6, Math.abs(sp) * 1.5)) * (S.laneCount > 16 ? 0.5 : 1) * dt * 60)
        r.splashes.push({ x: (Math.random() - 0.5) * 6, y: 0, vx: (Math.random() - 0.5) * 1.2, vy: sp >= 0 ? 1.5 + Math.random() * 2 : -1 - Math.random(), life: 1, size: 2 + Math.random() * 3.5 });
      r.splashes = r.splashes.filter(s => { s.x += s.vx * dt * 60; s.y += s.vy * dt * 60; s.life -= 0.035 * dt * 60; s.size += 0.06 * dt * 60; return s.life > 0; }).slice(-8);
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
    const colors = epic ? ["#ffd23f", "#ff8a1f", "#101010", "#ffffff", "#e83cc8"] : ["#2fa8ff", "#ff8a1f", "#e83cc8", "#c8102e", "#ffffff", "#ffd23f"];
    for (let i = 0; i < (epic ? 260 : 120); i++) S.confetti.push({
      x: Math.random() * S.w, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4,
      rot: Math.random() * 6.28, rv: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
    });
  }

  const yOf = (S, r) => S.startY - r.display * S.trackLen;

  function draw(S, hud) {
    const { ctx, w, h } = S;
    ctx.clearRect(0, 0, w, h);
    drawSpace(S); drawFinish(S); drawPad(S);
    // draw left-to-right; leaders drawn last so they sit on top
    [...S.racers].sort((a, b) => a.display - b.display).forEach(r => { drawExhaust(S, r); drawRacer(S, r); });
    const ranked = [...S.racers].sort((a, b) => b.progress - a.progress);
    const tagAll = S.laneCount <= 12;
    ranked.forEach((r, rank) => { if (tagAll || rank < 3 || r.mine) drawTag(S, r, rank + 1); });
    drawConfetti(S);
    if (hud) drawHUD(S, hud);
  }

  function drawSpace(S) {
    const { ctx, w, h } = S;
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, SPACE); g.addColorStop(0.55, SPACE2); g.addColorStop(1, DUSK);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // halftone haze near the pad (cached)
    if (!S.halftone) {
      const c = document.createElement("canvas"); c.width = w; c.height = h; const hc = c.getContext("2d"); hc.fillStyle = INK;
      for (let y = h - 8; y > h * 0.62; y -= 9) { const a = (h - y) / (h * 0.38); for (let x = 4; x < w; x += 9) { hc.beginPath(); hc.arc(x + ((y / 9) | 0) % 2 * 4, y, 1.1 + (1 - a) * 1.7, 0, 6.29); hc.fill(); } }
      S.halftone = c;
    }
    ctx.save(); ctx.globalAlpha = 0.18; ctx.drawImage(S.halftone, 0, 0, w, h); ctx.restore();
    // stars
    ctx.save(); ctx.fillStyle = "#fff";
    S.stars.forEach(s => { ctx.globalAlpha = 0.45 + Math.sin(s.ph) * 0.4; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.29); ctx.fill(); });
    ctx.restore();
    // moon
    ctx.save(); ctx.fillStyle = "#fff7d6"; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(w * 0.86, 44, 22, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e8dcb8"; [[-7, -4, 5], [6, 6, 4], [3, -9, 2.5]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(w * 0.86 + dx, 44 + dy, r, 0, 6.29); ctx.fill(); });
    ctx.restore();
    // ink speed streaks falling past the rockets (= rockets going up)
    ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineCap = "round";
    S.streaks.forEach(f => { ctx.globalAlpha = 0.28; ctx.lineWidth = f.w; ctx.beginPath(); ctx.moveTo(f.x, f.y - f.len); ctx.lineTo(f.x, f.y); ctx.stroke(); });
    ctx.restore();
    // lane guides
    ctx.save(); ctx.strokeStyle = "#fff"; ctx.globalAlpha = 0.08; ctx.lineWidth = 1; ctx.setLineDash([8, 12]); ctx.lineDashOffset = -S.time * 90;
    S.racers.forEach(r => { ctx.beginPath(); ctx.moveTo(r.laneX, S.finishY); ctx.lineTo(r.laneX, S.startY); ctx.stroke(); });
    ctx.restore();
  }

  function drawFinish(S) {
    const { ctx, w, finishY } = S;
    for (let x = 0; x < w; x += 10) { ctx.fillStyle = ((x / 10) | 0) % 2 ? INK : "#fff"; ctx.fillRect(x, finishY - 5, 10, 10); }
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(0, finishY - 5, w, 10);
    ctx.save(); ctx.translate(14, finishY - 14); ctx.transform(1, 0, -0.15, 1, 0, 0);
    ctx.fillStyle = "#c8102e"; ctx.fillRect(0, -22, 78, 26); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(0, -22, 78, 26);
    ctx.fillStyle = "#fff"; ctx.font = "700 14px Bangers, Impact, sans-serif"; ctx.fillText("ORBIT!", 10, -4); ctx.restore();
  }
  function drawPad(S) {
    const { ctx, w, h, startY } = S;
    const padY = startY + S.spriteH * 0.5;
    ctx.fillStyle = "#2a2a35"; ctx.fillRect(0, padY, w, h - padY);
    ctx.fillStyle = INK; ctx.fillRect(0, padY - 3, w, 4);
    ctx.save(); ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3; ctx.setLineDash([16, 12]); ctx.beginPath(); ctx.moveTo(0, padY + 12); ctx.lineTo(w, padY + 12); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(w - 90, padY + 30); ctx.transform(1, 0, -0.15, 1, 0, 0);
    ctx.fillStyle = INK; ctx.fillRect(0, 0, 76, 24); ctx.fillStyle = "#fff"; ctx.font = "700 14px Bangers, Impact, sans-serif"; ctx.fillText("LAUNCH", 8, 17); ctx.restore();
  }

  function drawExhaust(S, r) {
    const { ctx } = S; const x0 = r.laneX, y0 = yOf(S, r) + S.spriteH * 0.42;
    r.splashes.forEach(s => { ctx.fillStyle = `rgba(255,255,255,${s.life * 0.7})`; ctx.beginPath(); ctx.arc(x0 + s.x, y0 + s.y, s.size * (1.4 - s.life * 0.4), 0, 6.29); ctx.fill(); ctx.strokeStyle = `rgba(16,16,16,${s.life * 0.5})`; ctx.lineWidth = 1; ctx.stroke(); });
    if (r.racing && !S.over) { // flame
      const fl = S.spriteH * (0.35 + Math.sin(r.bob * 5) * 0.08), fw = S.spriteW * 0.22;
      ctx.save(); ctx.translate(x0, y0 - S.spriteH * 0.02);
      ctx.fillStyle = "#ff8a1f"; ctx.beginPath(); ctx.moveTo(-fw, 0); ctx.lineTo(fw, 0); ctx.lineTo(0, fl); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.moveTo(-fw * 0.5, 0); ctx.lineTo(fw * 0.5, 0); ctx.lineTo(0, fl * 0.55); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawRacer(S, r) {
    const { ctx } = S; const img = images[r.spriteId]; if (!img) return;
    const wid = S.spriteW, hgt = img.naturalHeight * (wid / img.naturalWidth);
    const y = yOf(S, r), wob = Math.sin(r.bob) * (S.spriteW > 30 ? 2.5 : 1);
    const left = r.laneX - wid / 2 + wob, top = y - hgt * 0.55;
    if (r.racing && !S.over) { ctx.save(); ctx.strokeStyle = "#fff"; ctx.globalAlpha = 0.55; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) { const sx = left - 4 + i * (wid + 8) / 2; ctx.beginPath(); ctx.moveTo(sx, top + hgt * 0.6 + i * 4); ctx.lineTo(sx, top + hgt * 0.6 + 22 + i * 6); ctx.stroke(); } ctx.restore(); }
    if (r.back && !S.over) { ctx.save(); ctx.strokeStyle = "#c8102e"; ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(left + wid * 0.2 + i * 6, top - 6 - i * 6); ctx.lineTo(left + wid * 0.2 + i * 6, top - 18 - i * 8); ctx.stroke(); } ctx.restore(); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, left, top, wid, hgt);
    if (S.leader === r.i && !S.over && S.script) {
      ctx.save(); ctx.font = `700 ${Math.max(14, hgt * 0.24)}px Bangers, Impact, sans-serif`; ctx.fillStyle = "#ffd23f"; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = "round";
      ctx.strokeText("!!", left + wid * 0.8, top + 4); ctx.fillText("!!", left + wid * 0.8, top + 4); ctx.restore();
    }
  }

  function drawTag(S, r, rank) {
    const { ctx } = S; const img = images[r.spriteId]; const hgt = img ? img.naturalHeight * (S.spriteW / img.naturalWidth) : S.spriteH;
    const y = yOf(S, r) - hgt * 0.55 - 8, x = r.laneX;
    const size = S.laneCount > 24 ? 10 : S.laneCount > 12 ? 11 : 13;
    ctx.font = `600 ${size}px "Space Grotesk", system-ui, sans-serif`;
    const label = `#${rank} ${r.name}`, tw = ctx.measureText(label).width;
    ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.fillStyle = r.mine ? "#ffd23f" : INK; ctx.fillRect(-tw / 2 - 7, -size - 3, tw + 14, size + 8);
    ctx.strokeStyle = r.mine ? INK : "#fff"; ctx.lineWidth = 1.5; ctx.strokeRect(-tw / 2 - 7, -size - 3, tw + 14, size + 8);
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
      ctx.fillStyle = hud.replay != null ? "#c8102e" : INK; ctx.fillRect(10, 10, tw, 32); ctx.fillStyle = hud.replay != null ? "#fff" : "#ffd23f"; ctx.fillText(hud.timer, 22, 33); ctx.restore(); }
    if (hud.replay != null) {   // slow-mo replay: letterbox bars, tint, big label, progress
      const { h } = S; ctx.save();
      ctx.fillStyle = "rgba(16,16,16,0.85)"; ctx.fillRect(0, 0, w, 26); ctx.fillRect(0, h - 26, w, 26);
      ctx.fillStyle = "rgba(255,210,63,0.06)"; ctx.fillRect(0, 0, w, h);
      const blink = Math.floor(performance.now() / 350) % 2 === 0;
      ctx.font = "700 34px Bangers, Impact, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 5; ctx.lineJoin = "round"; ctx.strokeStyle = INK; ctx.fillStyle = blink ? "#ffd23f" : "#fff";
      ctx.strokeText("◀ SLOW-MO REPLAY ▶", w / 2, h - 40); ctx.fillText("◀ SLOW-MO REPLAY ▶", w / 2, h - 40);
      ctx.fillStyle = "#c8102e"; ctx.fillRect(0, h - 4, w * hud.replay, 4);
      ctx.restore();
    }
    const standing = [...S.racers].sort((a, b) => b.progress - a.progress).slice(0, 5);
    const medal = ["1ST", "2ND", "3RD", "4TH", "5TH"];
    ctx.save(); ctx.font = "700 12px Bangers, Impact, sans-serif";
    standing.forEach((r, i) => { ctx.fillStyle = i === 0 ? "#ffd23f" : "#fff"; ctx.fillRect(w - 170, 90 + i * 24, 160, 20); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(w - 170, 90 + i * 24, 160, 20);
      ctx.fillStyle = INK; const nm = r.name.length > 12 ? r.name.slice(0, 11) + "…" : r.name; ctx.fillText(`${medal[i]}  ${nm}`, w - 162, 105 + i * 24); });
    ctx.restore();
  }

  return { loadSprites, images, makeScene, tick, draw, snapToEnd, confetti, get ready() { return ready; } };
})();
