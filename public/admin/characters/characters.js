import { coreSection } from '/admin/js/core.js';
import { loadLocale, t as translate, sanitizeFallback } from '/admin/js/i18n.js';

export function charactersPage() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    section: 'characters',
    loading: true,
    texts: {},
    items: [],
    sessionsIndex: {},
    scenariosIndex: {},
    filters: {
      role: '',
      query: '',
      session: ''
    },
    confirmModal: {
      open: false,
      message: '',
      onConfirm: null
    },
    editModal: {
      open: false,
      saving: false,
      error: '',
      sessionsInput: '',
      form: {
        id: '',
        name: '',
        role: '',
        type: '',
        race: '',
        history: '',
        hpCurrent: 0,
        hpMax: 0,
        sessions: [],
        parentScenario: ''
      }
    },
    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      this.texts = await loadLocale(this.lang, 'characters');
      await this.loadLookups();
      await this.refresh();
    },
    t(key, fallback) {
      return translate(this.texts, key, fallback);
    },
    ts(key, fallback) {
      return translate(this.texts, key, sanitizeFallback(fallback));
    },
    avatarThumbUrl(ch) {
      if (!ch?.avatar || !this.tenantId) return '';
      return `${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(ch.id)}/avatar-thumb`;
    },
    matchesFilters(ch) {
      const roleOk = this.filters.role ? (ch.role || '').toLowerCase() === this.filters.role.toLowerCase() : true;
      const sessionOk = this.filters.session
        ? Array.isArray(ch.sessions) && ch.sessions.includes(this.filters.session)
        : true;
      const q = (this.filters.query || '').toLowerCase();
      const queryOk = !q || [ch.name, ch.type, ch.race, ch.history].some(v => (v || '').toLowerCase().includes(q));
      return roleOk && sessionOk && queryOk;
    },
    scenarioTitle(id) {
      if (!id) return '';
      return this.scenariosIndex[id] || id;
    },
    sessionTitles(ids = []) {
      if (!Array.isArray(ids) || !ids.length) return '';
      return ids.map(id => this.sessionsIndex[id] || id).join(', ');
    },
    async loadLookups() {
      if (!this.tenantId) return;
      try {
        const sessRes = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions`, { headers: this.headersAuth() });
        if (sessRes.ok) {
          const sessions = await sessRes.json();
          this.sessionsIndex = (sessions || []).reduce((acc, s) => {
            acc[s.id] = s.title || s.id;
            return acc;
          }, {});
        }
      } catch (_) {
        this.sessionsIndex = {};
      }
      try {
        const scRes = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios`, { headers: this.headersAuth() });
        if (scRes.ok) {
          const scenarios = await scRes.json();
          this.scenariosIndex = (scenarios || []).reduce((acc, sc) => {
            acc[sc.id] = sc.title || sc.id;
            return acc;
          }, {});
        }
      } catch (_) {
        this.scenariosIndex = {};
      }
    },
    async refresh() {
      if (!this.tenantId) return;
      this.loading = true;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/characters`, { headers: this.headersAuth() });
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        this.items = list.filter(ch => this.matchesFilters(ch));
      } catch (_) {
        this.items = [];
      }
      this.loading = false;
    },
    openCharacterModal(ch = null) {
      if (!ch) return;
      const sessions = Array.isArray(ch.sessions) ? ch.sessions : [];
      this.editModal = {
        open: true,
        saving: false,
        error: '',
        sessionsInput: sessions.join(', '),
        form: {
          id: ch.id || '',
          name: ch.name || '',
          role: (ch.role || '').toLowerCase(),
          type: ch.type || '',
          race: ch.race || '',
          history: ch.history || '',
          hpCurrent: Number.isFinite(ch.hpCurrent) ? ch.hpCurrent : 0,
          hpMax: Number.isFinite(ch.hpMax) ? ch.hpMax : 0,
          sessions,
          parentScenario: ch.parentScenario || ''
        }
      };
    },
    closeCharacterModal() {
      this.editModal = {
        open: false,
        saving: false,
        error: '',
        sessionsInput: '',
        form: {
          id: '',
          name: '',
          role: '',
          type: '',
          race: '',
          history: '',
          hpCurrent: 0,
          hpMax: 0,
          sessions: [],
          parentScenario: ''
        }
      };
    },
    async saveCharacter() {
      if (!this.tenantId || !this.editModal.form.id) return;
      const form = { ...this.editModal.form };
      if (!form.name.trim()) {
        this.editModal.error = this.t('errors.name', 'Nom requis');
        return;
      }
      const sessionsInput = this.editModal.sessionsInput || '';
      const sessions = sessionsInput.split(',').map(s => s.trim()).filter(Boolean);
      const payload = {
        ...form,
        role: (form.role || '').toLowerCase(),
        sessions,
        parentScenario: form.parentScenario || null,
        hpCurrent: Number.isFinite(form.hpCurrent) ? form.hpCurrent : 0,
        hpMax: Number.isFinite(form.hpMax) ? form.hpMax : 0
      };
      this.editModal.saving = true;
      this.editModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(form.id)}`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'save');
        await this.refresh();
        this.closeCharacterModal();
      } catch (err) {
        this.editModal.error = err?.message || this.t('errors.save', 'Sauvegarde impossible');
      }
      this.editModal.saving = false;
    },
    async deleteCharacter(id) {
      if (!this.tenantId || !id) return;
      const ch = this.items.find(c => c.id === id);
      const sessions = Array.isArray(ch?.sessions) ? ch.sessions : [];
      const msg = sessions.length
        ? this.t('confirmDeleteWithSessions', 'Supprimer ce personnage ? Il est utilisé dans les sessions : {list}.')
            .replace('{list}', this.sessionTitles(sessions))
        : this.t('confirmDelete', 'Supprimer ce personnage ?');
      this.confirmModal = {
        open: true,
        message: msg,
        onConfirm: async () => {
          try {
            await fetch(`${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              headers: this.headersAuth()
            });
            await this.refresh();
          } catch (_) {}
        }
      };
    }
  };
}

window.charactersPage = charactersPage;
