import { coreSection } from '/admin/js/core.js';
import { DEFAULT_SCENARIO_ICON, DEFAULT_SESSION_ICON, ICON_OPTIONS, filterIcons } from '/admin/js/icon-picker-utils.js';

export function scenariosListSection() {
  return {
    scenarios: [],
    sessions: [],
    loading: true,
    error: '',
    defaultScenarioIcon: DEFAULT_SCENARIO_ICON,
    defaultSessionIcon: DEFAULT_SESSION_ICON,
    iconOptions: ICON_OPTIONS,
    confirmModal: {
      open: false,
      item: null,
      message: ''
    },
    createModal: {
      open: false,
      title: '',
      icon: DEFAULT_SCENARIO_ICON,
      iconSearch: '',
      saving: false,
      error: ''
    },
    editModal: {
      open: false,
      title: '',
      id: '',
      icon: DEFAULT_SCENARIO_ICON,
      iconSearch: '',
      createdAt: '',
      saving: false,
      error: ''
    },
    sessionModal: {
      open: false,
      title: '',
      scenarioId: '',
      icon: DEFAULT_SESSION_ICON,
      iconSearch: '',
      saving: false,
      error: ''
    },

    async init() {
      const baseInit = coreSection().init;
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      this.section = 'scenarios';
      await Promise.all([this.fetchScenarios(), this.fetchSessions()]);
    },

    formatDate(ts) {
      if (!ts) return '';
      const val = Number(ts);
      const date = new Date((String(val).length === 13 ? val : val * 1000));
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('fr-FR', { dateStyle: 'short' });
    },

    async fetchScenarios() {
      if (!this.tenantId) {
        this.loading = false;
        return;
      }
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Impossible de charger les scénarios');
        const data = await res.json();
        this.scenarios = Array.isArray(data)
          ? [...data].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          : [];
      } catch (err) {
        this.error = err?.message || 'Erreur de chargement';
        this.scenarios = [];
      } finally {
        this.loading = false;
      }
    },

    async fetchSessions() {
      if (!this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Impossible de charger les sessions');
        this.sessions = await res.json();
      } catch (err) {
        this.sessions = [];
      }
    },

    sessionsFor(scenarioId) {
      return this.sessions.filter(s => s.parentScenario === scenarioId);
    },

    filteredIcons(query = '') {
      return filterIcons(query, this.iconOptions);
    },

    openCreateModal() {
      this.createModal = {
        open: true,
        title: '',
        icon: this.defaultScenarioIcon,
        iconSearch: '',
        saving: false,
        error: ''
      };
    },

    closeCreateModal() {
      this.createModal = {
        open: false,
        title: '',
        icon: this.defaultScenarioIcon,
        iconSearch: '',
        saving: false,
        error: ''
      };
    },

    async submitCreate() {
      if (!this.tenantId) return;
      const title = (this.createModal.title || '').trim();
      if (!title) {
        this.createModal.error = 'Le titre est requis';
        return;
      }
      this.createModal.saving = true;
      this.createModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({
            title,
            icon: this.createModal.icon || this.defaultScenarioIcon
          })
        });
        if (!res.ok) throw new Error('Création impossible');
        await this.fetchScenarios();
        await this.fetchSessions();
        this.closeCreateModal();
        window.location.reload();
      } catch (err) {
        this.createModal.error = err?.message || 'Erreur lors de la création';
      } finally {
        this.createModal.saving = false;
      }
    },

    openSessionModal(scenarioId) {
      this.sessionModal = {
        open: true,
        title: '',
        scenarioId,
        icon: DEFAULT_SESSION_ICON,
        iconSearch: '',
        saving: false,
        error: ''
      };
    },

    closeSessionModal() {
      this.sessionModal = {
        open: false,
        title: '',
        scenarioId: '',
        icon: DEFAULT_SESSION_ICON,
        iconSearch: '',
        saving: false,
        error: ''
      };
    },

    async submitSession() {
      const title = (this.sessionModal.title || '').trim();
      if (!title) {
        this.sessionModal.error = 'Le titre est requis';
        return;
      }
      if (!this.tenantId || !this.sessionModal.scenarioId) {
        this.sessionModal.error = 'Scénario introuvable';
        return;
      }
      this.sessionModal.saving = true;
      this.sessionModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({
            title,
            parentScenario: this.sessionModal.scenarioId,
            icon: this.sessionModal.icon || DEFAULT_SESSION_ICON
          })
        });
        if (!res.ok) throw new Error('Création impossible');
        const created = await res.json();
        await this.fetchSessions();
        await this.fetchScenarios();
        this.closeSessionModal();
        if (created?.id) {
          window.location.href = `/admin/sessions/view.html?id=${encodeURIComponent(created.id)}`;
        }
      } catch (err) {
        this.sessionModal.error = err?.message || 'Erreur lors de la création';
      } finally {
        this.sessionModal.saving = false;
      }
    },

    openEditModal(item) {
      if (!item || !item.id) return;
      this.editModal = {
        open: true,
        title: item.title || '',
        id: item.id,
        icon: item.icon || this.defaultScenarioIcon,
        iconSearch: '',
        createdAt: item.createdAt || '',
        saving: false,
        error: ''
      };
    },

    closeEditModal() {
      this.editModal = {
        open: false,
        title: '',
        id: '',
        icon: this.defaultScenarioIcon,
        iconSearch: '',
        createdAt: '',
        saving: false,
        error: ''
      };
    },

    async submitEdit() {
      const title = (this.editModal.title || '').trim();
      if (!title) {
        this.editModal.error = 'Le titre est requis';
        return;
      }
      if (!this.tenantId || !this.editModal.id) {
        this.editModal.error = 'Scénario introuvable';
        return;
      }
      this.editModal.saving = true;
      this.editModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios/${encodeURIComponent(this.editModal.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({
            title,
            icon: this.editModal.icon || this.defaultScenarioIcon
          })
        });
        if (!res.ok) throw new Error('Mise à jour impossible');
        await this.fetchScenarios();
        this.closeEditModal();
        window.location.reload();
      } catch (err) {
        this.editModal.error = err?.message || 'Erreur lors de la sauvegarde';
      } finally {
        this.editModal.saving = false;
      }
    },

    async deleteScenario(item) {
      if (!item || !item.id || !this.tenantId) return;
      this.confirmModal = {
        open: true,
        item,
        message: `Supprimer ${item.title || item.id}, les sessions et les scènes" ?`
      };
    },

    closeConfirm() {
      this.confirmModal = { open: false, item: null, message: '' };
    },

    async confirmDelete() {
      const item = this.confirmModal.item;
      this.closeConfirm();
      if (!item || !item.id || !this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios/${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('Suppression impossible');
        await this.fetchScenarios();
        window.location.reload();
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la suppression';
      }
    }
  };
}

export function scenariosListPage() {
  return {
    ...coreSection(),
    ...scenariosListSection()
  };
}

window.scenariosListPage = scenariosListPage;
