/* Games manga page — panels fly in on scroll, tilt toward the mouse, SFX words slam in. */
(function () {
  // hero stickers slam in on load
  const st = document.querySelectorAll("#stickers .sticker"); const showSt = () => st.forEach(s => s.classList.add("is-in")); setTimeout(showSt, 250); window.addEventListener("load", () => setTimeout(showSt, 50)); document.addEventListener("visibilitychange", showSt);
  const page = document.getElementById("mangaPage");
  if (!page) return;
  const panels = [...page.querySelectorAll(".mp__panel")];
  panels.forEach(p => { const s = document.createElement("span"); s.className = "mp__shine"; p.appendChild(s); });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // scroll-in
  const showAll = () => panels.forEach(p => p.classList.add("is-in"));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: 0.15 });
    panels.forEach(p => io.observe(p));
    setTimeout(() => panels.forEach(p => { const r = p.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) p.classList.add("is-in"); }), 1500);
  } else showAll();

  // 3D tilt + shine follow the pointer (mouse only)
  if (reduce || !window.matchMedia("(hover: hover)").matches) return;
  panels.forEach(p => {
    p.addEventListener("pointermove", e => {
      const r = p.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      p.style.setProperty("--ty", ((x - 0.5) * 10).toFixed(2) + "deg");
      p.style.setProperty("--tx", ((0.5 - y) * 8).toFixed(2) + "deg");
      p.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); p.style.setProperty("--my", (y * 100).toFixed(1) + "%");
    });
    p.addEventListener("pointerleave", () => { p.style.setProperty("--tx", "0deg"); p.style.setProperty("--ty", "0deg"); });
  });
})();
