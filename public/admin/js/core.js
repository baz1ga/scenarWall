export function coreSection() {
  return {
    API: getApiBase(),
    token: getToken(),
    tenantId: getTenant(),
    isSuperAdmin: isAdmin(),
    section: 'galerie',
    breadcrumb: 'Administration',
    title: 'ScenarWall',
    theme: 'dark',
    sidebarCollapsed: false,
    userMenu: false,
    avatarUrl: getAvatar() || '',
    avatarInitial: 'A',
    displayName: getDisplayName() || '',
    quotaDisplay: '—',
    quotaPercent: 0,
    zoomUrl: '',
    confirmModal: {
      open: false,
      message: '',
      action: null
    },
    recentScenarios: [],
    recentSessionsIndex: {},

    async init() {
      if (window.API_READY && typeof window.API_READY.then === 'function') {
        try { await window.API_READY; } catch (e) {}
      }
      if (window.PIXABAY_KEY) {
        this.pixabayKey = window.PIXABAY_KEY;
      }
      if (!this.token) {
        window.location.href = '/index.html';
        return;
      }
      try {
        const payload = JSON.parse(atob(this.token.split('.')[1] || ''));
        if (payload.email) this.avatarInitial = payload.email.charAt(0).toUpperCase();
        this.displayName = payload.displayName || payload.email || '';
        if (payload.avatarUrl) {
          this.avatarUrl = payload.avatarUrl;
          setAvatar(payload.avatarUrl);
        }
      } catch (e) {}

      if (!this.tenantId) {
        this.section = this.isSuperAdmin ? 'users' : 'galerie';
      }

      const storedTheme = localStorage.getItem('sw_theme');
      this.theme = storedTheme === 'light' ? 'light' : 'dark';
      this.applyThemeClass();
      const storedSidebar = localStorage.getItem('sw_admin_sidebar_collapsed');
      this.sidebarCollapsed = storedSidebar === '1';

      // section depuis l'URL ?section=...
      const params = new URLSearchParams(window.location.search || '');
      const requested = params.get('section');
      const allowed = ['home', 'galerie', 'audio', 'tension', 'users', 'gm', 'scenarios'];
      if (requested && allowed.includes(requested)) {
        this.section = requested;
      }

      if (typeof this.fetchQuota === 'function') this.fetchQuota();
      if (typeof this.refreshGallery === 'function') this.refreshGallery();
      if (typeof this.loadAudio === 'function') this.loadAudio();
      if (typeof this.loadTension === 'function') this.loadTension();
      if (this.isSuperAdmin && typeof this.loadUsers === 'function') {
        this.loadUsers();
      }
      if (this.isSuperAdmin && typeof this.loadGlobalQuota === 'function') {
        this.loadGlobalQuota();
      }
      this.fetchRecentScenarios?.();

      // charger les données de la section demandée
      if (this.section === 'audio' && typeof this.loadAudio === 'function') {
        this.loadAudio();
      }
      if (this.section === 'tension' && typeof this.loadTension === 'function') {
        this.loadTension();
      }
      if (this.section === 'users' && this.isSuperAdmin && typeof this.loadUsers === 'function') {
        this.loadUsers();
      }
    },

    navigateSection(target) {
      const adminPath = window.location.pathname.startsWith('/admin');
      if (!adminPath) {
        window.location.href = `/admin/?section=${target}`;
        return;
      }
      this.section = target;
      if (target === 'galerie' && typeof this.refreshGallery === 'function') {
        this.refreshGallery();
      }
      if (target === 'audio' && typeof this.loadAudio === 'function') {
        this.loadAudio();
      }
      if (target === 'tension' && typeof this.loadTension === 'function') {
        this.loadTension();
      }
      if (target === 'users' && this.isSuperAdmin && typeof this.loadUsers === 'function') {
        this.loadUsers();
      }
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('section', target);
        window.history.replaceState({}, '', url.toString());
      } catch (e) {}
  },

  headersAuth() {
      return withCsrf({
        'Authorization': 'Bearer ' + this.token
      });
  },
  headersGod() {
      return withCsrf({
        'x-auth-token': this.token
      });
  },

    formatBytes(bytes) {
      const val = Number(bytes) || 0;
      if (val === 0) return '0 B';
      const units = ['B','KB','MB','GB','TB'];
      const i = Math.min(Math.floor(Math.log(val) / Math.log(1024)), units.length - 1);
      const size = val / Math.pow(1024, i);
      return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`;
  },

    openScenarioModalFromLayout() {
      const isOnScenarioPage = window.location.pathname.includes('/admin/scenarios/scenarios.html');
      window.location.href = '/admin/scenarios/edit.html';
    },

    async fetchRecentScenarios() {
      if (!this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('scenarios');
        const data = await res.json();
        if (Array.isArray(data)) {
          // index sessions -> title for sidebar display
          try {
            const sessRes = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions`, { headers: this.headersAuth() });
            if (sessRes.ok) {
              const sessions = await sessRes.json();
              this.recentSessionsIndex = (sessions || []).reduce((acc, s) => {
                acc[s.id] = s.title || s.id;
                return acc;
              }, {});
            }
          } catch (e) {}
          this.recentScenarios = [...data]
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, 8);
        } else {
          this.recentScenarios = [];
        }
      } catch (e) {
        this.recentScenarios = [];
      }
    },

    lookupSessionTitle(id) {
      if (!id) return '';
      return this.recentSessionsIndex[id] || id;
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('sw_theme', this.theme);
      this.applyThemeClass();
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem('sw_admin_sidebar_collapsed', this.sidebarCollapsed ? '1' : '0');
    },

    applyThemeClass() {
      document.documentElement.classList.toggle('dark', this.theme === 'dark');
    },

    setBreadcrumb() {
      const map = {
        galerie: 'Galerie', audio: 'Audio', tension: 'Tension', users: 'Utilisateurs', quotas: 'Quotas', scenarios: 'Scénarios'
      };
      this.breadcrumb = 'Administration / ' + (map[this.section] || '');
      this.title = map[this.section] || 'Administration';
    },

    askConfirm(message, action) {
      this.confirmModal.message = message;
      this.confirmModal.action = action;
      this.confirmModal.open = true;
    },
    closeConfirm() {
      this.confirmModal.open = false;
      this.confirmModal.message = '';
      this.confirmModal.action = null;
    },
    async confirmYes() {
      const action = this.confirmModal.action;
      this.closeConfirm();
      if (typeof action === 'function') {
        await action();
      }
    },

    async fetchQuota() {
      if (!this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/${this.tenantId}/quota`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Quota');
        const data = await res.json();
        const valueText = `${data.quotaMB} Mo`;
        const usageText = `${data.usage} Mo`;
        this.quotaDisplay = `${usageText} / ${valueText}`;
        this.quotaPercent = data.quotaMB > 0 ? Math.min(100, (data.usage / data.quotaMB) * 100) : 0;
      } catch (e) {
        this.quotaDisplay = '—';
        this.quotaPercent = 0;
      }
    },

    openFront() {
      if (!this.tenantId) return;
      window.open(`/t/${this.tenantId}/front`, '_blank');
    },
  };
}
