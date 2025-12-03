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
      const storedSidebar = localStorage.getItem('sw_admin_sidebar_collapsed');
      this.sidebarCollapsed = storedSidebar === '1';

      this.refreshGallery();
      this.loadAudio();
      this.loadTension();
      this.fetchQuota();
      if (this.isSuperAdmin) {
        this.loadUsers();
        this.loadGlobalQuota();
      }
    },

    headersAuth() {
      return { 'Authorization': 'Bearer ' + this.token };
    },
    headersGod() {
      return { 'x-auth-token': this.token };
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('sw_theme', this.theme);
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem('sw_admin_sidebar_collapsed', this.sidebarCollapsed ? '1' : '0');
    },

    setBreadcrumb() {
      const map = {
        galerie: 'Galerie', audio: 'Audio', tension: 'Tension', users: 'Utilisateurs', quotas: 'Quotas'
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
  };
}
