import { coreSection } from './core.js';

export function gmDashboard() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    section: 'gm',
    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      this.section = 'gm';
      this.breadcrumb = 'Game Master';
    }
  };
}

// Alpine a besoin de l'exposer en global
window.gmDashboard = gmDashboard;
