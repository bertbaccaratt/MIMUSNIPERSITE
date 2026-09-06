/* Games carousel — scroll-snap track with prev/next + arrow keys + drag. */
(function () {
  const track = document.getElementById("gamesTrack");
  const prev = document.getElementById("prevBtn");
  const next = document.getElementById("nextBtn");
  if (!track) return;

  const step = () => (track.querySelector(".game")?.getBoundingClientRect().width || 300) + 26;
  prev?.addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));
  next?.addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));

  track.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") next.click();
    if (e.key === "ArrowLeft") prev.click();
  });
  track.tabIndex = 0;

  // mouse drag to scroll
  let down = false, startX = 0, startL = 0, moved = false;
  track.addEventListener("pointerdown", e => { down = true; moved = false; startX = e.clientX; startL = track.scrollLeft; });
  window.addEventListener("pointermove", e => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    track.scrollLeft = startL - dx;
  });
  window.addEventListener("pointerup", () => { down = false; });
  track.addEventListener("click", e => { if (moved) e.preventDefault(); }, true);
})();
