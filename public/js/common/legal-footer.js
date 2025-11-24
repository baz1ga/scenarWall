(function attachFragments() {
  document.addEventListener("DOMContentLoaded", async () => {
    const placeholders = Array.from(document.querySelectorAll("[data-include]"));
    if (!placeholders.length) return;

    const cache = new Map();

    async function loadFragment(name) {
      if (cache.has(name)) return cache.get(name);
      try {
        const res = await fetch(`/fragments/${name}.html`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`fragment ${name} not found`);
        const html = await res.text();
        cache.set(name, html);
        return html;
      } catch (err) {
        console.error(`Impossible de charger le fragment ${name} :`, err);
        cache.set(name, "");
        return "";
      }
    }

    for (const el of placeholders) {
      const name = el.dataset.include;
      if (!name) continue;
      const html = await loadFragment(name);
      if (!html) continue;

      el.innerHTML = html;
      const root = el.firstElementChild;
      const variant = el.dataset.variant;
      if (root && variant) {
        root.classList.add(`variant-${variant}`);
      }
    }
  });
})();
