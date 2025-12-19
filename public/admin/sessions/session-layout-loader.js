(function sessionLayoutLoader() {
  if (window.__SW_SESSION_LAYOUT_APPLIED) return;
  window.__SW_SESSION_LAYOUT_APPLIED = true;

  async function applyLayout() {
    const fragmentEl = document.querySelector('#session-fragment');
    const search = window.location.search || '';
    let fragmentHtml = fragmentEl ? fragmentEl.outerHTML : '';

    // Si aucun fragment local, on récupère par défaut le fragment scènes
    if (!fragmentHtml) {
      try {
        const res = await fetch(`/admin/sessions/edit-scenes.html${search}`, { cache: 'no-cache' });
        const html = await res.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const fallback = parsed.querySelector('#session-fragment');
        fragmentHtml = fallback ? fallback.outerHTML : '';
      } catch (err) {
        console.error('Impossible de charger le fragment par défaut (edit-scenes)', err);
      }
    }

    if (!fragmentHtml) return;

    let viewHtml = '';
    try {
      const res = await fetch(`/admin/sessions/view.html${search}`, { cache: 'no-cache' });
      viewHtml = await res.text();
    } catch (err) {
      console.error('Impossible de charger view.html pour session-layout-loader', err);
      return;
    }

    const parser = new DOMParser();
    const parsed = parser.parseFromString(viewHtml, 'text/html');
    const slot = parsed.querySelector('[data-session-content-slot]');
    if (!slot) {
      console.error('Slot data-session-content-slot introuvable dans view.html');
      return;
    }
    slot.innerHTML = fragmentHtml;

    const serializer = new XMLSerializer();
    const htmlString = '<!DOCTYPE html>\n' + serializer.serializeToString(parsed);
    document.open();
    document.write(htmlString);
    document.close();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLayout);
  } else {
    applyLayout();
  }
})();
