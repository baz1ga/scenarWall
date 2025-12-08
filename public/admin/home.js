import { coreSection } from '/admin/js/core.js';

export function homePage() {
  return {
    ...coreSection(),
    section: 'home'
  };
}

window.homePage = homePage;
