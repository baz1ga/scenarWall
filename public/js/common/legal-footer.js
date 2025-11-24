(function attachLegalFooter() {
  document.addEventListener("DOMContentLoaded", async () => {
    const placeholders = document.querySelectorAll('[data-include="legal-footer"]');
    if (!placeholders.length) return;

    let fragment = "";
    try {
      const res = await fetch("/fragments/legal-footer.html", { cache: "no-cache" });
      if (!res.ok) throw new Error("footer fragment not found");
      fragment = await res.text();
    } catch (err) {
      console.error("Impossible de charger le footer légal :", err);
      return;
    }

    placeholders.forEach(el => {
      el.innerHTML = fragment;
      const footer = el.querySelector(".sw-legal-footer");
      if (!footer) return;

      const variant = el.dataset.variant;
      if (variant) footer.classList.add(`variant-${variant}`);
    });
  });
})();
