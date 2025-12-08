import { coreSection } from '/js/admin/core.js';

export function usersSection() {
  return {
    users: [],
    usersLoading: false,
    hideInactiveUsers: false,
    hideInactiveQuota: false,
    userSort: { key: 'name', dir: 'asc' },
    quotaSort: { key: 'name', dir: 'asc' },
    globalQuotaValue: '',
    globalQuotaMessage: '',
    globalQuotaStatus: 'ok',
    tenantQuotaModal: {
      open: false,
      user: null,
      value: '',
      error: ''
    },

    usageData(u) {
      const usageMB = u.quotaUsedBytes ? (u.quotaUsedBytes / 1024 / 1024) : 0;
      const quotaMB = u.quotaMB || 0;
      const percent = quotaMB > 0 ? Math.min(100, (usageMB / quotaMB) * 100) : 0;
      const text = quotaMB ? `${usageMB.toFixed(2)} / ${quotaMB} Mo${u.quotaOverride ? ' (perso)' : ''}` : `${usageMB.toFixed(2)} Mo (quota non défini)`;
      return { usageMB, quotaMB, percent, text };
    },
    usageTitle(u) {
      const { usageMB, quotaMB, percent } = this.usageData(u);
      return quotaMB ? `${usageMB.toFixed(2)} / ${quotaMB} Mo (${percent.toFixed(1)}%)` : `${usageMB.toFixed(2)} Mo (quota non défini)`;
    },
    totalUsageText() {
      const total = (this.users || []).reduce((sum, u) => sum + this.usageData(u).usageMB, 0);
      return `${total.toFixed(2)} Mo`;
    },
    sortValue(u, key) {
      const { usageMB } = this.usageData(u);
      switch (key) {
        case 'name': return (u.displayName || u.email || '').toLowerCase();
        case 'email': return (u.email || '').toLowerCase();
        case 'images': return u.imageCount || 0;
        case 'audios': return u.audioCount || 0;
        case 'usage': return usageMB;
        case 'lastLogin': return u.lastLogin ? new Date(u.lastLogin).getTime() : 0;
        default: return 0;
      }
    },
    sortList(list, conf) {
      const f = conf.dir === 'asc' ? 1 : -1;
      return [...list].sort((a, b) => {
        const va = this.sortValue(a, conf.key);
        const vb = this.sortValue(b, conf.key);
        if (va < vb) return -1 * f;
        if (va > vb) return 1 * f;
        return 0;
      });
    },
    filteredUsers(mode) {
      const sortConf = mode === 'users' ? this.userSort : this.quotaSort;
      return this.sortList(this.users || [], sortConf);
    },
    setUserSort(key) {
      if (this.userSort.key === key) {
        this.userSort.dir = this.userSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        this.userSort = { key, dir: 'asc' };
      }
    },
    setQuotaSort(key) {
      if (this.quotaSort.key === key) {
        this.quotaSort.dir = this.quotaSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        this.quotaSort = { key, dir: 'asc' };
      }
    },
    sortIcon(key, mode) {
      const conf = mode === 'users' ? this.userSort : this.quotaSort;
      if (conf.key !== key) return 'fa-solid fa-sort text-slate-400';
      return conf.dir === 'asc' ? 'fa-solid fa-sort-up text-emerald-500' : 'fa-solid fa-sort-down text-emerald-500';
    },
    async loadUsers() {
      this.usersLoading = true;
      try {
        const res = await fetch(`${this.API}/api/godmode/users`, { headers: this.headersGod() });
        if (!res.ok) throw new Error('Users');
        this.users = await res.json();
      } catch (e) {
        this.users = [];
      }
      this.usersLoading = false;
    },
    async deleteUser(email) {
      this.askConfirm('Supprimer définitivement ce compte ?', async () => {
        await fetch(`${this.API}/api/godmode/user/${email}`, {
          method: 'DELETE',
          headers: { ...this.headersGod(), 'Content-Type': 'application/json' }
        });
        this.loadUsers();
      });
    },
    async loadGlobalQuota() {
      try {
        const res = await fetch(`${this.API}/api/godmode/global-quota`, { headers: this.headersGod() });
        if (!res.ok) throw new Error('Global');
        const data = await res.json();
        this.globalQuotaValue = data.defaultQuotaMB || '';
        this.globalQuotaMessage = '';
      } catch (e) {
        this.globalQuotaMessage = 'Impossible de charger le quota global.';
        this.globalQuotaStatus = 'error';
      }
    },
    async saveGlobalQuota() {
      const value = parseFloat(this.globalQuotaValue);
      if (Number.isNaN(value) || value <= 0) {
        this.globalQuotaMessage = 'Entrez une valeur valide (>0).';
        this.globalQuotaStatus = 'error';
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/godmode/global-quota`, {
          method: 'PUT',
          headers: { ...this.headersGod(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultQuotaMB: value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
        this.globalQuotaMessage = 'Quota global mis à jour.';
        this.globalQuotaStatus = 'ok';
        this.loadUsers();
      } catch (err) {
        this.globalQuotaMessage = err.message || 'Échec de la mise à jour.';
        this.globalQuotaStatus = 'error';
      }
    },
    async editTenantQuota(u) {
      this.openTenantQuotaModal(u);
    },
    openTenantQuotaModal(user) {
      this.tenantQuotaModal.user = user;
      this.tenantQuotaModal.value = user?.quotaOverride ? user.quotaMB : '';
      this.tenantQuotaModal.error = '';
      this.tenantQuotaModal.open = true;
    },
    closeTenantQuotaModal() {
      this.tenantQuotaModal = { open: false, user: null, value: '', error: '' };
    },
    async saveTenantQuota() {
      const user = this.tenantQuotaModal.user;
      if (!user) return;
      const trimmed = (this.tenantQuotaModal.value ?? '').toString().trim();
      let payloadValue = null;
      if (trimmed !== '') {
        const num = parseFloat(trimmed);
        if (Number.isNaN(num) || num <= 0) {
          this.tenantQuotaModal.error = 'Entrez un nombre positif ou laissez vide pour quota global.';
          return;
        }
        payloadValue = num;
      }
      this.tenantQuotaModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/godmode/tenant-quota`, {
          method: 'PUT',
          headers: { ...this.headersGod(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: user.tenantId || '', quotaMB: payloadValue })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
        this.closeTenantQuotaModal();
        this.loadUsers();
      } catch (err) {
        this.tenantQuotaModal.error = err.message || 'Impossible de mettre à jour le quota.';
      }
    },
  };
}

export function usersPage() {
  return {
    ...coreSection(),
    ...usersSection(),
    section: 'users'
  };
}

window.usersPage = usersPage;
