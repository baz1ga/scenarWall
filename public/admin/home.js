import { coreSection } from '/admin/js/core.js';

export function homePage() {
  return {
    ...coreSection(),
    section: 'home',
    async init() {
      const baseInit = coreSection().init;
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      window.location.href = '/admin/scenarios/list.html';
    }
  };
}

window.homePage = homePage;
