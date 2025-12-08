(function layoutLoader() {
  if (window.__SW_LAYOUT_APPLIED) return;
  window.__SW_LAYOUT_APPLIED = true;

  try {
    const savedTheme = localStorage.getItem('sw_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const mode = savedTheme === 'light' ? 'light' : (savedTheme === 'dark' ? 'dark' : (prefersDark ? 'dark' : 'light'));
    document.documentElement.classList.toggle('dark', mode === 'dark');
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', async () => {
    const htmlEl = document.documentElement;
    const previousVisibility = htmlEl.style.visibility;
    htmlEl.style.visibility = 'hidden';

    try {
    const contentEl = document.querySelector('#page-content');
    if (!contentEl) return;
    const contentContainer = document.querySelector('main');
    let loaderEl = null;
    if (contentContainer) {
      loaderEl = document.createElement('div');
      loaderEl.className = 'flex justify-center py-10';
      loaderEl.innerHTML = '<div class="animate-spin h-8 w-8 rounded-full border-4 border-emerald-500 border-t-transparent"></div>';
      contentContainer.appendChild(loaderEl);
    }
    const pageContent = contentEl.outerHTML;
    const pageScripts = Array.from(document.querySelectorAll('script[data-page-script]'));

    let layoutHtml = '';
    try {
      const res = await fetch('/admin/layout/layout.html', { cache: 'no-cache' });
      layoutHtml = await res.text();
    } catch (e) {
      console.error('Impossible de charger le layout admin', e);
      return;
    }

    if (!layoutHtml.includes('{{CONTENT}}')) {
      console.error('Layout admin: placeholder {{CONTENT}} introuvable');
      return;
    }

    const mergedHtml = layoutHtml.replace('{{CONTENT}}', pageContent);
    const parser = new DOMParser();
    const parsed = parser.parseFromString(mergedHtml, 'text/html');

    // Bloque l'auto-init Alpine pour démarrer après les scripts de page
    window.__swStartAlpine = null;
    window.deferLoadingAlpine = (callback) => { window.__swStartAlpine = callback; };

    // Déplacer le contexte Alpine du fragment vers le layout pour que sidebar/header y accèdent
    const pageRoot = parsed.querySelector('#page-content');
    if (pageRoot) {
      const target = parsed.body;
      const alpineAttrs = ['x-data', 'x-init', 'x-bind:class', ':class'];
      alpineAttrs.forEach((name) => {
        if (pageRoot.hasAttribute(name)) {
          target.setAttribute(name, pageRoot.getAttribute(name));
        }
      });
      // x-cloak peut rester sur le fragment, Alpine le retirera
    }

    async function rebuildHead(fromHead) {
      document.head.innerHTML = '';
      for (const node of Array.from(fromHead.childNodes)) {
        if (node.tagName === 'SCRIPT') {
          await new Promise((resolve) => {
            const s = document.createElement('script');
            Array.from(node.attributes).forEach((attr) => s.setAttribute(attr.name, attr.value));
            s.textContent = node.textContent || '';
            s.onload = () => resolve();
            s.onerror = () => resolve();
            document.head.appendChild(s);
            if (!s.src) resolve();
          });
        } else {
          document.head.appendChild(node.cloneNode(true));
        }
      }
    }

    await rebuildHead(parsed.head);

    const newBody = document.createElement('body');
    Array.from(parsed.body.attributes).forEach((attr) => newBody.setAttribute(attr.name, attr.value));
    Array.from(parsed.body.childNodes).forEach((node) => newBody.appendChild(node.cloneNode(true)));
    document.documentElement.replaceChild(newBody, document.body);

    async function loadFragments() {
      const placeholders = Array.from(document.querySelectorAll('[data-include]'));
      if (!placeholders.length) return;
      const cache = new Map();
      async function fetchFragment(name) {
        if (cache.has(name)) return cache.get(name);
        try {
          const res = await fetch(`/fragments/${name}.html`, { cache: 'no-cache' });
          if (!res.ok) throw new Error('Fragment not found');
          const html = await res.text();
          cache.set(name, html);
          return html;
        } catch (err) {
          console.error(`Impossible de charger le fragment ${name}`, err);
          cache.set(name, '');
          return '';
        }
      }
      for (const el of placeholders) {
        const name = el.dataset.include;
        if (!name) continue;
        const html = await fetchFragment(name);
        if (!html) continue;
        el.innerHTML = html;
        const root = el.firstElementChild;
        const variant = el.dataset.variant;
        if (root && variant) {
          root.classList.add(`variant-${variant}`);
        }
      }
    }

    await loadFragments();

    async function waitForGlobals(maxMs = 2000) {
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          if (typeof window.getApiBase === 'function' && typeof window.getToken === 'function') {
            resolve(true);
            return;
          }
          if (Date.now() - start > maxMs) {
            resolve(false);
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
    }

    await waitForGlobals();

    const loadPageScript = (oldScript) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      Array.from(oldScript.attributes).forEach((attr) => s.setAttribute(attr.name, attr.value));
      s.textContent = oldScript.textContent || '';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Impossible de charger le script de page ${oldScript.src || ''}`));
      document.body.appendChild(s);
      // Si script inline (pas de src), on résout immédiatement
      if (!oldScript.src) resolve();
    });

    try {
      await Promise.all(pageScripts.map(loadPageScript));
    } catch (err) {
      console.error(err);
    }

    if (typeof window.__swStartAlpine === 'function') {
      window.__swStartAlpine();
    } else {
      // fallback: retire x-cloak pour ne pas laisser l'UI vide
      document.querySelectorAll('[x-cloak]').forEach(el => el.removeAttribute('x-cloak'));
    }

    if (loaderEl && loaderEl.parentNode) {
      loaderEl.parentNode.removeChild(loaderEl);
    }
    } finally {
      htmlEl.style.visibility = previousVisibility;
    }
  });
})();
