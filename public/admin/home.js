import { coreSection } from '/js/admin/core.js';

export function homePage() {
  return {
    ...coreSection(),
    section: 'home'
  };
}

window.homePage = homePage;
