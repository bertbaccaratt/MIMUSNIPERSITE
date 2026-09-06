/* MIMU Floatz — app state machine. Players self-join; the booth sets prize + length and starts. */
(() => {
  const E = FloatzEngine, R = window.FloatzRenderImpl || FloatzRender;
  const NOUN = window.FLOATZ_NOUN || "float", NOUNS = NOUN + "s", TITLE = window.FLOATZ_TITLE || "MIMU FLOAT RACE";
  const ADMIN_PASSWORD = "5555WENUMIM";          // change me
  const COUNTDOWN_MS = 30000, MAX_TICKETS = 3;
  const DEVICE = Store.deviceId();
  // Firebase drops empty arrays/objects — put the defaults back on every read
  Store.normalize("lobby", l => l ? { racers: [], tickets: {}, voters: {}, ...l, racers: Array.isArray(l.racers) ? l.racers : Object.values(l.racers || {}) } : null);
  Store.normalize("stats", s => s ? { recorded: [], ...s } : null);
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  // ---------- SFX ----------
  const sfx = (() => {
    let ctx; const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    function tone(f, t0, dur, type = "square", vol = 0.12, slide) {
      const c = ac(), o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + t0 + dur);
      g.gain.setValueAtTime(0.0001, c.currentTime + t0); g.gain.exponentialRampToValueAtTime(vol, c.currentTime + t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
      o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.02);
    }
    return {
      beep: () => tone(880, 0, 0.12), go: () => { tone(523, 0, 0.1); tone(659, 0.1, 0.1); tone(784, 0.2, 0.1); tone(1047, 0.3, 0.35, "square", 0.14); },
      horn: () => tone(220, 0, 0.6, "sawtooth", 0.08, 180),
      win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.5, i === 4 ? "triangle" : "square", 0.1)),
      lose: () => { tone(392, 0, 0.25, "triangle", 0.1); tone(330, 0.25, 0.4, "triangle", 0.1, 260); },
      resume: () => { if (ctx?.state === "suspended") ctx.resume(); },
      _load(n) {
        const c = ac(); const url = E.assetUrl(`assets/sfx/cd${n}.mp3`);
        const bytes = url.startsWith("data:")
          ? Promise.resolve(Uint8Array.from(atob(url.split(",")[1]), ch => ch.charCodeAt(0)).buffer)
          : fetch(url).then(r => r.arrayBuffer());
        return bytes.then(b => c.decodeAudioData(b)).then(buf => ((this._clips ||= {})[n] = buf));
      },
      // Announcer: recorded clips (assets/sfx/cd3..cd0.mp3) through a stadium echo.
      announce(n) {
        const c = ac();
        const play = buf => {
          const t = c.currentTime + 0.02;
          const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = 0.94;   // a touch deeper
          const dry = c.createGain(); dry.gain.value = 0.9;
          const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
          // slap echo + longer stadium tail
          const d1 = c.createDelay(1); d1.delayTime.value = 0.16; const f1 = c.createGain(); f1.gain.value = 0.42;
          const d2 = c.createDelay(1); d2.delayTime.value = 0.31; const f2 = c.createGain(); f2.gain.value = 0.3;
          const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
          const wet = c.createGain(); wet.gain.value = 0.55;
          src.connect(dry).connect(comp);
          src.connect(d1); d1.connect(f1); f1.connect(lp); f1.connect(d1);      // feedback loop 1
          src.connect(d2); d2.connect(f2); f2.connect(lp); f2.connect(d2);      // feedback loop 2
          lp.connect(wet).connect(comp); comp.connect(c.destination);
          src.start(t);
        };
        if (this._clips?.[n]) return play(this._clips[n]);
        this._load(n).then(play).catch(e => { console.warn("announcer clip failed", n, e); this.beep(); });
      },
      preload() { [3, 2, 1, 0].forEach(n => this._load(n).catch(e => console.warn("announcer preload failed", n, e))); },
    };
  })();

  // ---------- state ----------
  let role = null;                // 'player' | 'admin'
  let lobby = null;               // shared record
  let scene = null, script = null, anim = null, lastCountdownSec = -1, shownResultFor = null, joinedRaceId = null;
  let selectedSprite = null;

  const defaultLobby = () => ({ id: "L" + Store.now().toString(36), state: "closed", maxRacers: E.MAX_RACERS, durationMs: 60000,
    prize: { type: "ape", stake: 500, label: "" }, racers: [], tickets: {}, voters: {}, createdAt: Store.now() });

  function prizeTotal(l) {
    const n = l.racers.length, p = l.prize;
    if (p.type === "custom") return p.label || "Mystery prize";
    const total = (p.stake || 0) * n;
    return p.type === "nft" ? `${total.toLocaleString()} MIMU NFT${total === 1 ? "" : "s"}` : `${total.toLocaleString()} $APE`;
  }
  function prizeStake(l) { const p = l.prize; return p.type === "custom" ? p.label : p.type === "nft" ? `${p.stake} MIMU NFT each` : `${p.stake.toLocaleString()} $APE each`; }
  const myRacer = () => lobby?.racers.find(r => r.deviceId === DEVICE) || null;

  // ---------- stats ----------
  const STATS_SEED = { races: 99, apeWon: 17759, nftWon: 151, losses: 997, visitors: 3462, recorded: [] };
  function stats() { return Store.get("stats") || Store.set("stats", STATS_SEED) || STATS_SEED; }
  function renderStats() {
    const s = stats();
    $("stat-races").textContent = s.races.toLocaleString(); $("stat-ape").textContent = s.apeWon.toLocaleString() + " $APE";
    $("stat-nft").textContent = s.nftWon.toLocaleString() + " MIMU NFTs"; $("stat-losses").textContent = s.losses.toLocaleString(); $("stat-visits").textContent = s.visitors.toLocaleString();
  }
  function recordVisitor() { if (!localStorage.getItem((window.FLOATZ_STORE_PREFIX || "floatz:") + "visited")) { localStorage.setItem((window.FLOATZ_STORE_PREFIX || "floatz:") + "visited", "1"); Store.update("stats", s => ({ ...(s || STATS_SEED), visitors: (s?.visitors ?? STATS_SEED.visitors) + 1 })); } }
  function recordRace(l) {
    Store.update("stats", s => { s = s || STATS_SEED; if (s.recorded?.includes(l.raceId)) return s;
      const n = l.racers.length, pot = (l.prize.stake || 0) * n;
      return { ...s, races: s.races + 1, apeWon: s.apeWon + (l.prize.type === "ape" ? pot : 0), nftWon: s.nftWon + (l.prize.type === "nft" ? pot : 0), losses: s.losses + Math.max(0, n - 1), recorded: [...(s.recorded || []), l.raceId].slice(-500) }; });
  }

  // ---------- views ----------
  function show(view) { document.querySelectorAll(".view").forEach(v => v.classList.toggle("hidden", v.id !== "view-" + view)); window.scrollTo({ top: 0 }); }

  function onLobby(l) {
    if (l && l.maxRacers !== E.MAX_RACERS) l = { ...l, maxRacers: E.MAX_RACERS };
    lobby = l;
    if (!role) return;
    if (role === "admin") renderBooth();
    if (role === "player") renderJoin();
    // race views for both roles
    if (l && (l.state === "countdown" || l.state === "racing" || l.state === "finished")) enterRace(l); else if (scene) leaveRace();
  }

  // ---------- JOIN (players) ----------
  function renderJoin() {
    const l = lobby, me = myRacer();
    const open = l && l.state === "open";
    $("join-status").textContent = !l || l.state === "closed" ? "Lobby closed — waiting for the booth to open the next race." :
      open ? `${l.racers.length} / ${l.maxRacers} ${NOUNS} claimed · Prize: ${prizeTotal(l)}` :
      l.state === "countdown" ? "Roster locked — race starting!" : l.state === "racing" ? "Race in progress" : "Race finished — waiting for the next one";
    $("join-form").classList.toggle("hidden", !open || !!me);
    $("join-me").classList.toggle("hidden", !me);
    $("join-closed").classList.toggle("hidden", !!l && l.state !== "closed");
    if (me) { $("me-name").textContent = me.name; $("me-sprite").src = E.spriteUrl(me.spriteId); }
    // sprite grid
    const grid = $("sprite-grid"); grid.innerHTML = "";
    const taken = new Set((l?.racers || []).map(r => r.spriteId));
    E.SPRITES.forEach(id => {
      const b = document.createElement("button"); b.type = "button"; b.className = "sprite-pick"; b.dataset.id = id;
      const isTaken = taken.has(id);
      b.disabled = isTaken; b.classList.toggle("is-taken", isTaken); b.classList.toggle("is-selected", selectedSprite === id && !isTaken);
      b.innerHTML = `<img src="${E.spriteUrl(id)}" alt="${id}"><span>${isTaken ? "taken" : id.replace(/-/g, " ")}</span>`;
      b.addEventListener("click", () => { selectedSprite = id; renderJoin(); });
      grid.appendChild(b);
    });
    if (selectedSprite && taken.has(selectedSprite)) selectedSprite = null;
    $("join-btn").disabled = !selectedSprite || !$("join-name").value.trim();
    // roster
    $("join-roster").innerHTML = (l?.racers || []).map(r => `<li><img src="${E.spriteUrl(r.spriteId)}" alt=""><b>${esc(r.name)}</b>${r.deviceId === DEVICE ? " <i>(you)</i>" : ""}</li>`).join("");
    $("join-full").classList.toggle("hidden", !(open && l.racers.length >= l.maxRacers && !me));
  }

  function join() {
    const name = $("join-name").value.trim().slice(0, 18);
    if (!name || !selectedSprite) return;
    let ok = false, reason = "";
    Store.update("lobby", l => {
      if (!l || l.state !== "open") { reason = "Lobby isn't open."; return l; }
      if (l.racers.some(r => r.deviceId === DEVICE)) { reason = `This device already has a ${NOUN}.`; return l; }
      if (l.racers.some(r => r.spriteId === selectedSprite)) { reason = `Someone just grabbed that ${NOUN} — pick another.`; return l; }
      if (l.racers.length >= l.maxRacers) { reason = "Race is full."; return l; }
      if (l.racers.some(r => r.name.toLowerCase() === name.toLowerCase())) { reason = "That name's taken."; return l; }
      ok = true; return { ...l, racers: [...l.racers, { id: "r" + Store.now().toString(36) + Math.random().toString(36).slice(2, 6), deviceId: DEVICE, name, spriteId: selectedSprite, joinedAt: Store.now() }] };
    });
    if (!ok) alert(reason); else sfx.go();
  }
  function leave() { Store.update("lobby", l => (!l || l.state !== "open") ? l : { ...l, racers: l.racers.filter(r => r.deviceId !== DEVICE) }); }

  // ---------- BOOTH (admin) ----------
  function renderBooth() {
    const l = lobby;
    const state = l?.state || "closed";
    $("booth-state").textContent = state.toUpperCase();
    $("booth-state").dataset.state = state;
    ["open-lobby", "close-lobby", "start-race", "run-back", "double", "new-lobby"].forEach(id => $(id).classList.add("hidden"));
    if (state === "closed") $("open-lobby").classList.remove("hidden");
    if (state === "open") { $("close-lobby").classList.remove("hidden"); $("start-race").classList.remove("hidden"); $("start-race").disabled = (l.racers.length < 2); }
    if (state === "finished") { $("run-back").classList.remove("hidden"); $("double").classList.remove("hidden"); $("new-lobby").classList.remove("hidden"); }
    const editable = state === "closed" || state === "open";
    ["duration-sec", "prize-type", "prize-stake", "prize-label"].forEach(id => { $(id).disabled = !editable; });
    if (l && !$("booth-form").dataset.dirty) {
      $("duration-sec").value = Math.round(l.durationMs / 1000);
      $("prize-type").value = l.prize.type; $("prize-stake").value = l.prize.stake; $("prize-label").value = l.prize.label || "";
    }
    $("prize-label").classList.toggle("hidden", $("prize-type").value !== "custom");
    $("prize-stake").classList.toggle("hidden", $("prize-type").value === "custom");
    $("booth-pot").textContent = l ? `Pot: ${prizeTotal(l)} · ${l.racers.length} racer${l.racers.length === 1 ? "" : "s"}` : "";
    $("roster-count").textContent = `${(l?.racers || []).length} / ${E.MAX_RACERS}`;
    $("booth-roster").innerHTML = (l?.racers || []).map(r => `<li><img src="${E.spriteUrl(r.spriteId)}" alt=""><b>${esc(r.name)}</b><span>${r.spriteId}</span>${editable ? `<button type="button" class="kick" data-id="${r.id}" title="Remove">×</button>` : ""}</li>`).join("") || "<li class='empty'>No racers yet.</li>";
    $("booth-roster").querySelectorAll(".kick").forEach(b => b.addEventListener("click", () => Store.update("lobby", x => ({ ...x, racers: x.racers.filter(r => r.id !== b.dataset.id) }))));
  }
  function readBoothForm() {
    const type = $("prize-type").value;
    return {
      maxRacers: E.MAX_RACERS,
      durationMs: Math.max(10, Math.min(600, parseInt($("duration-sec").value, 10) || 60)) * 1000,
      prize: { type, stake: Math.max(1, parseInt($("prize-stake").value, 10) || 1), label: $("prize-label").value.trim().slice(0, 40) },
    };
  }
  function applyBoothForm() { $("booth-form").dataset.dirty = ""; Store.update("lobby", l => ({ ...(l || defaultLobby()), ...readBoothForm() })); }
  function openLobby() { Store.set("lobby", { ...defaultLobby(), ...readBoothForm(), state: "open" }); }
  function closeLobby() { Store.update("lobby", l => ({ ...l, state: "closed", racers: [] })); }
  function startCountdown() {
    Store.update("lobby", l => {
      if (!l || l.racers.length < 2) return l;
      const now = Store.now();
      return { ...l, ...readBoothForm(), state: "countdown", raceId: "R" + now.toString(36), seed: E.Rng.newSeed(), countdownEndsAt: now + COUNTDOWN_MS, tickets: {}, voters: {}, isDouble: !!l.isDouble };
    });
  }
  // called by the admin tab when the countdown hits zero: lock the draw and go
  function finalizeStart() {
    Store.update("lobby", l => {
      if (!l || l.state !== "countdown") return l;
      const idx = {}; l.racers.forEach((r, i) => { idx[i] = l.tickets[r.id] || 0; });
      const { winnerIndex, weights } = E.drawWinner(l.racers.length, idx, new E.Rng(l.seed));
      return { ...l, state: "racing", startedAt: l.countdownEndsAt, winnerIndex, weights };
    });
  }
  function finishRace() { Store.update("lobby", l => (l && l.state === "racing") ? { ...l, state: "finished" } : l); }
  function runBack(double) {
    Store.update("lobby", l => ({ ...l, state: "countdown", raceId: "R" + Store.now().toString(36), seed: E.Rng.newSeed(), countdownEndsAt: Store.now() + COUNTDOWN_MS, tickets: {}, voters: {},
      prize: double && l.prize.type !== "custom" ? { ...l.prize, stake: l.prize.stake * 2 } : l.prize, isDouble: !!double }));
  }
  function addManual() {
    const name = $("manual-name").value.trim().slice(0, 18); if (!name) return;
    let msg = "";
    Store.update("lobby", l => {
      if (!l || l.state !== "open") { msg = "Open the lobby first."; return l; }
      if (l.racers.length >= l.maxRacers) { msg = "Race is full."; return l; }
      if (l.racers.some(r => r.name.toLowerCase() === name.toLowerCase())) { msg = "Name taken."; return l; }
      const free = E.SPRITES.filter(id => !l.racers.some(r => r.spriteId === id)); if (!free.length) { msg = `No ${NOUNS} left.`; return l; }
      const spriteId = free[Math.floor(Math.random() * free.length)];
      return { ...l, racers: [...l.racers, { id: "r" + Store.now().toString(36) + Math.random().toString(36).slice(2, 6), deviceId: "booth", name, spriteId, joinedAt: Store.now(), manual: true }] };
    });
    if (msg) alert(msg); else $("manual-name").value = "";
  }
  function newLobby() { Store.set("lobby", { ...defaultLobby(), ...readBoothForm(), state: "open" }); }

  // ---------- TICKETS ----------
  function myTickets() { return lobby?.voters?.[DEVICE] || {}; }
  function ticketsLeft() { return MAX_TICKETS - Object.values(myTickets()).reduce((a, b) => a + b, 0); }
  function castTicket(racerId) {
    Store.update("lobby", l => {
      if (!l || l.state !== "countdown") return l;
      const mine = l.voters[DEVICE] || {}; if (Object.values(mine).reduce((a, b) => a + b, 0) >= MAX_TICKETS) return l;
      return { ...l, tickets: { ...l.tickets, [racerId]: (l.tickets[racerId] || 0) + 1 }, voters: { ...l.voters, [DEVICE]: { ...mine, [racerId]: (mine[racerId] || 0) + 1 } } };
    });
    sfx.beep();
  }
  function renderVotes() {
    const l = lobby, panel = $("vote-panel"); if (!l) return;
    const voting = l.state === "countdown";
    panel.classList.toggle("hidden", !(voting || l.state === "racing" || l.state === "finished"));
    const total = Object.values(l.tickets || {}).reduce((a, b) => a + b, 0), mine = myTickets(), left = ticketsLeft();
    $("vote-head").textContent = voting ? `🎟 ${left} ticket${left === 1 ? "" : "s"} left · ${total} in the pool` : `${total} tickets placed · boosts locked`;
    $("vote-picks").innerHTML = l.racers.map(r => {
      const n = l.tickets[r.id] || 0, pct = total ? Math.round(n / total * 100) : 0, boost = Math.min(E.MAX_BOOST, 1 + n * E.BOOST_PER_TICKET);
      return `<button type="button" class="vote-pick ${mine[r.id] ? "is-mine" : ""}" data-id="${r.id}" ${voting && left > 0 ? "" : "disabled"}>
        <img src="${E.spriteUrl(r.spriteId)}" alt=""><span class="vp-name">${esc(r.name)}${mine[r.id] ? ` ×${mine[r.id]}` : ""}</span>
        <span class="vp-bar"><i style="width:${pct}%"></i></span><span class="vp-meta">${pct}% · ${boost.toFixed(2)}×</span></button>`;
    }).join("");
    $("vote-picks").querySelectorAll(".vote-pick").forEach(b => b.addEventListener("click", () => castTicket(b.dataset.id)));
  }

  // ---------- RACE ----------
  function enterRace(l) {
    show("race");
    if (!scene || joinedRaceId !== l.raceId || scene.racers.length !== l.racers.length) {
      joinedRaceId = l.raceId; script = null; shownResultFor = null;
      const roster = l.racers.map(r => ({ ...r, mine: r.deviceId === DEVICE }));
      scene = R.makeScene($("race-canvas"), roster, null, roster.length);
      $("race-result").classList.add("hidden");
      cancelAnimationFrame(anim); anim = requestAnimationFrame(loop);
    }
    if ((l.state === "racing" || l.state === "finished") && !script && l.winnerIndex != null) {
      script = E.buildRace({ count: l.racers.length, winnerIndex: l.winnerIndex, durationMs: l.durationMs, seed: l.seed });
      const roster = l.racers.map(r => ({ ...r, mine: r.deviceId === DEVICE }));
      scene = R.makeScene($("race-canvas"), roster, script, roster.length);
      if (l.state === "racing") sfx.horn();
    }
    $("race-title").textContent = l.isDouble ? "DOUBLE OR NOTHIN" : TITLE;
    $("race-prize").textContent = `Prize: ${prizeTotal(l)} · ${l.racers.length} racers · ${Math.round(l.durationMs / 1000)}s`;
    renderVotes();
    if (l.state === "finished" && shownResultFor !== l.raceId) showResult(l);
  }
  function leaveRace() { cancelAnimationFrame(anim); scene = null; script = null; joinedRaceId = null; if (role === "admin") show("booth"); else show("join"); }

  function loop() {
    anim = requestAnimationFrame(loop);
    const l = lobby; if (!scene || !l) return;
    const now = Store.now();
    if (l.state === "countdown") {
      const sec = Math.max(0, Math.ceil((l.countdownEndsAt - now) / 1000));
      $("countdown").classList.remove("hidden"); $("countdown-num").textContent = sec > 0 ? sec : "GO!";
      $("countdown-hint").textContent = myRacer() ? "You're in this race — place your tickets!" : "Place your tickets — each one boosts a racer's odds";
      if (sec !== lastCountdownSec) { if (sec > 0 && sec <= 3) { sfx.beep(); sfx.announce(sec); } if (sec === 0) { sfx.go(); sfx.announce(0); } lastCountdownSec = sec; }
      if (role === "admin" && now >= l.countdownEndsAt) finalizeStart();
      R.tick(scene, null); R.draw(scene, null); return;
    }
    $("countdown").classList.add("hidden");
    if (!script) { R.tick(scene, null); R.draw(scene, null); return; }
    const elapsed = now - l.startedAt, t = Math.min(1, elapsed / l.durationMs);
    if (elapsed >= l.durationMs) {
      if (!scene.over) { R.snapToEnd(scene); R.confetti(scene, !!l.isDouble); if (role === "admin") { finishRace(); recordRace(l); } if (l.state === "finished" && shownResultFor !== l.raceId) showResult(l); }
      R.tick(scene, 1); R.draw(scene, { timer: "00:00" }); return;
    }
    R.tick(scene, t);
    const rem = Math.max(0, Math.ceil((l.durationMs - elapsed) / 1000));
    R.draw(scene, { timer: `${String(Math.floor(rem / 60)).padStart(2, "0")}:${String(rem % 60).padStart(2, "0")}` });
  }

  function showResult(l) {
    shownResultFor = l.raceId;
    const w = l.racers[l.winnerIndex]; if (!w) return;
    const box = $("race-result"); box.classList.remove("hidden"); box.classList.toggle("is-epic", !!l.isDouble);
    $("result-sprite").src = E.spriteUrl(w.spriteId);
    $("result-name").textContent = `${w.name} WINS!`;
    $("result-prize").textContent = `Takes ${prizeTotal(l)}`;
    $("result-sub").textContent = `${prizeStake(l)} × ${l.racers.length} racers${l.isDouble ? " · Double or Nothin" : ""}`;
    const mine = myTickets(), me = myRacer();
    let line = "";
    if (me && me.id === w.id) line = "🏆 THAT'S YOU. Witness them.";
    else if (mine[w.id]) line = `🎯 Called it — you had ${mine[w.id]} ticket${mine[w.id] > 1 ? "s" : ""} on ${w.name}.`;
    else if (Object.keys(mine).length) line = NOUN === "float" ? "💨 Your pick didn't float hard enough." : "💥 Your pick never made orbit.";
    $("result-you").textContent = line;
    const bw = l.weights?.[l.winnerIndex]; $("result-odds").textContent = bw ? `Winner's draw weight: ${bw.toFixed(2)}× (${l.tickets[w.id] || 0} tickets). Seed ${l.seed.map(x => x.toString(16)).join("")}` : "";
    $("result-admin").classList.toggle("hidden", role !== "admin"); $("result-public").classList.toggle("hidden", role === "admin");
    if (me && me.id === w.id) sfx.win(); else if (mine[w.id]) sfx.win(); else sfx.lose();
  }

  // ---------- wiring ----------
  function init() {
    recordVisitor(); renderStats(); Store.subscribe("stats", renderStats);
    R.loadSprites(E.SPRITES);
    $("go-join").addEventListener("click", () => { role = "player"; show("join"); onLobby(Store.get("lobby")); });
    $("go-booth").addEventListener("click", () => { $("gate").classList.remove("hidden"); $("gate-pass").focus(); });
    $("gate-cancel").addEventListener("click", () => $("gate").classList.add("hidden"));
    const tryGate = () => { if ($("gate-pass").value === ADMIN_PASSWORD) { $("gate").classList.add("hidden"); role = "admin"; show("booth"); onLobby(Store.get("lobby")); } else $("gate-err").classList.remove("hidden"); };
    $("gate-go").addEventListener("click", tryGate); $("gate-pass").addEventListener("keydown", e => e.key === "Enter" && tryGate());
    document.querySelectorAll(".back-home").forEach(b => b.addEventListener("click", () => { role = null; leaveRaceQuiet(); show("home"); }));
    $("join-name").addEventListener("input", renderJoin); $("join-btn").addEventListener("click", join); $("leave-btn").addEventListener("click", leave);
    $("open-lobby").addEventListener("click", openLobby); $("close-lobby").addEventListener("click", closeLobby); $("start-race").addEventListener("click", startCountdown);
    $("run-back").addEventListener("click", () => runBack(false)); $("double").addEventListener("click", () => runBack(true)); $("new-lobby").addEventListener("click", newLobby);
    $("booth-form").addEventListener("input", () => { $("booth-form").dataset.dirty = "1"; renderBooth(); });
    $("booth-form").addEventListener("change", applyBoothForm);
    $("manual-add").addEventListener("click", addManual); $("manual-name").addEventListener("keydown", e => e.key === "Enter" && addManual());
    $("result-back-booth").addEventListener("click", () => show("booth"));
    $("result-wait").addEventListener("click", () => show("join"));
    document.addEventListener("pointerdown", () => { sfx.resume(); sfx.preload(); }, { once: true });
    Store.subscribe("lobby", onLobby);
    window.addEventListener("resize", () => { if (scene && lobby) { const roster = lobby.racers.map(r => ({ ...r, mine: r.deviceId === DEVICE })); const keep = scene.racers.map(r => r.display); scene = R.makeScene($("race-canvas"), roster, script, roster.length); scene.racers.forEach((r, i) => { r.display = r.progress = keep[i]; }); } });
  }
  function leaveRaceQuiet() { cancelAnimationFrame(anim); scene = null; script = null; joinedRaceId = null; }
  document.addEventListener("DOMContentLoaded", () => Store.preload(["lobby", "stats"]).then(init));
})();
