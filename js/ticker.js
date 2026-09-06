/* Market ticker — pulls from OpenSea public v2 endpoints (no API key needed).
   Top offer + listed count need an API key; add OPENSEA_API_KEY below when you have one. */
(function () {
  const OPENSEA_API_KEY = ""; // optional
  const SLUG = "mimuonape";
  const BASE = "https://api.opensea.io/api/v2";
  const track = document.getElementById("tickerTrack");
  if (!track) return;

  const fmt = (n, d = 2) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
  const headers = OPENSEA_API_KEY ? { "x-api-key": OPENSEA_API_KEY } : {};

  async function get(path) {
    const r = await fetch(BASE + path, { headers });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }

  function render(items) {
    const html = items.map(([k, v]) =>
      `<span class="ticker__item"><i class="ticker__dot"></i>${k}: <b>${v}</b></span>`).join("");
    track.innerHTML = html + html; // duplicate for seamless loop
  }

  async function load() {
    try {
      const [col, stats] = await Promise.all([get(`/collections/${SLUG}`), get(`/collections/${SLUG}/stats`)]);
      // OpenSea reports volume in ETH for this chain; convert to APE using the listing currency's ETH price.
      const apePerEth = 1 / Number(col.pricing_currencies?.listing_currency?.eth_price || 0);
      const toApe = (eth) => (isFinite(apePerEth) && apePerEth > 0 ? eth * apePerEth : eth);
      const day = stats.intervals.find(i => i.interval === "one_day") || {};
      const week = stats.intervals.find(i => i.interval === "seven_day") || {};
      const supply = Number(col.total_supply || 5555);
      const owners = Number(stats.total.num_owners || 0);

      const items = [
        ["Collection", col.name || "MIMU On Ape"],
        ["Chain", "ApeChain"],
        ["Floor", fmt(stats.total.floor_price) + " APE"],
        ["24h Vol", fmt(toApe(day.volume || 0), 1) + " APE"],
        ["24h Sales", fmt(day.sales || 0, 0)],
        ["7d Vol", fmt(toApe(week.volume || 0), 0) + " APE"],
        ["Total Vol", fmt(toApe(stats.total.volume || 0), 0) + " APE"],
        ["Total Sales", fmt(stats.total.sales || 0, 0)],
        ["Owners", `${fmt(owners, 0)} (${fmt(owners / supply * 100, 1)}%)`],
        ["Supply", fmt(supply, 0)],
      ];

      if (OPENSEA_API_KEY) {
        try {
          const offers = await get(`/offers/collection/${SLUG}`);
          const best = offers.offers?.[0];
          if (best) {
            const wei = Number(best.price?.value || best.protocol_data?.parameters?.offer?.[0]?.startAmount || 0);
            const qty = Number(best.protocol_data?.parameters?.consideration?.[0]?.startAmount || 1);
            items.splice(3, 0, ["Top Offer", fmt(wei / 1e18 / qty) + " WAPE"]);
          }
        } catch (e) { /* offer endpoint unavailable */ }
        try {
          const listings = await get(`/listings/collection/${SLUG}/all?limit=100`);
          if (listings.listings) items.push(["Listed", fmt(listings.listings.length, 0) + (listings.next ? "+" : "")]);
        } catch (e) { /* listings endpoint unavailable */ }
      }

      render(items);
    } catch (err) {
      console.warn("Ticker failed:", err);
      // last-known snapshot (Sep 2026) so the bar is never empty
      render([
        ["Collection", "MIMU On Ape"], ["Chain", "ApeChain"], ["Floor", "200 APE"],
        ["24h Vol", "690 APE"], ["24h Sales", "3"], ["7d Vol", "13,710 APE"],
        ["Total Vol", "1,500,400 APE"], ["Total Sales", "5,243"], ["Owners", "894 (16.1%)"],
        ["Supply", "5,555"], ["Data", "cached"],
      ]);
    }
  }

  load();
  setInterval(load, 5 * 60 * 1000);
})();
