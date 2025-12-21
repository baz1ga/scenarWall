(function sessionLayoutLoader() {
  if (window.__SW_SESSION_LAYOUT_APPLIED) return;
  window.__SW_SESSION_LAYOUT_APPLIED = true;

  async function applyLayout() {
    const lang = (localStorage.getItem('lang') || (navigator.language || 'fr').slice(0, 2) || 'fr').toLowerCase();
    let texts = {};
    const t = (key, fallback = '') => {
      if (!key) return fallback || '';
      const parts = key.split('.');
      let cur = texts;
      for (const p of parts) {
        if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
          cur = cur[p];
        } else {
          cur = undefined;
          break;
        }
      }
      if (cur === undefined || cur === null) return fallback || key;
      if (typeof cur === 'string' || typeof cur === 'number') return cur;
      return fallback || key;
    };
    try {
      const res = await fetch(`/locales/${lang}/sessions-scenes.json`);
      texts = res.ok ? await res.json() : {};
    } catch (_) {
      texts = {};
    }

    if (window.__SW_SESSION_LAYOUT_DONE) return;
    window.__SW_SESSION_LAYOUT_DONE = true;
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
        console.error(t('layoutLoader.defaultFragmentError', 'Impossible de charger le fragment par défaut (edit-scenes)'), err);
      }
    }

    if (!fragmentHtml) return;

    let viewHtml = '';
    const desiredScriptSrc = (() => {
      const path = (window.location.pathname || '').toLowerCase();
      if (path.includes('edit-scenes')) return '/admin/sessions/edit-scenes.js';
      if (path.includes('edit-tension')) return '/admin/sessions/edit-tension.js';
      if (path.includes('edit-table')) return '/admin/sessions/edit-table.js';
      if (path.includes('edit-pnj')) return '/admin/sessions/edit-pnj.js';
      if (path.includes('edit-sessions')) return '/admin/sessions/edit-sessions.js';
      return '/admin/sessions/view.js';
    })();
    try {
      const res = await fetch(`/admin/sessions/view.html${search}`, { cache: 'no-cache' });
      viewHtml = await res.text();
    } catch (err) {
      console.error(t('layoutLoader.viewError', 'Impossible de charger view.html pour session-layout-loader'), err);
      return;
    }

    const parser = new DOMParser();
    const parsed = parser.parseFromString(viewHtml, 'text/html');
    const slot = parsed.querySelector('[data-session-content-slot]');
    if (!slot) {
      console.error(t('layoutLoader.slotMissing', 'Slot data-session-content-slot introuvable dans view.html'));
      return;
    }
    slot.innerHTML = fragmentHtml;

    // Adapter le script principal si besoin (ex: page edit-scenes)
    const pageScript = parsed.querySelector('script[data-page-script]');
    if (pageScript) {
      pageScript.setAttribute('src', desiredScriptSrc);
    }

    // Rendu sans document.write : extraire les scripts, poser head/body, rejouer les scripts (sans recharger ce loader)
    const scripts = Array.from(parsed.querySelectorAll('script')).map(script => ({
      parent: script.closest('head') ? 'head' : 'body',
      attrs: Array.from(script.attributes).map(attr => ({ name: attr.name, value: attr.value })),
      content: script.textContent || '',
      src: script.getAttribute('src') || ''
    }));
    parsed.querySelectorAll('script').forEach(s => s.remove());

    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;

    for (const info of scripts) {
      if (info.src.includes('session-layout-loader.js')) continue; // ne pas relancer le loader
      await new Promise(resolve => {
        const el = document.createElement('script');
        info.attrs.forEach(attr => el.setAttribute(attr.name, attr.value));
        if (!info.src) {
          el.textContent = info.content;
          (info.parent === 'head' ? document.head : document.body).appendChild(el);
          resolve();
          return;
        }
        el.onload = () => resolve();
        el.onerror = () => resolve();
        (info.parent === 'head' ? document.head : document.body).appendChild(el);
      });
    }

    try { document.dispatchEvent(new Event('DOMContentLoaded')); } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLayout);
  } else {
    applyLayout();
  }
})();
