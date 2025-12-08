import { coreSection } from './core.js';

export function dashboard() {
  return {
    ...coreSection(),
  };
}

window.dashboard = dashboard;
