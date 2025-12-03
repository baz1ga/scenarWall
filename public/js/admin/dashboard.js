import { coreSection } from './core.js';
import { gallerySection } from './gallery.js';
import { audioSection } from './audio.js';
import { tensionSection } from './tension.js';
import { usersSection } from './users.js';

export function dashboard() {
  return {
    ...coreSection(),
    ...gallerySection(),
    ...audioSection(),
    ...tensionSection(),
    ...usersSection(),
  };
}

// Alpine expects dashboard in the global scope
window.dashboard = dashboard;
