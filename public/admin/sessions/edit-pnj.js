import { sessionViewPage } from './view.js';
import { loadLocale, t as translate } from '/admin/js/i18n.js';

// Expose i18n helpers for this page
window.__pnjI18n = { loadLocale, translate };

// Point d'entrée dédié pour la page edit-pnj
window.sessionViewPage = sessionViewPage;
