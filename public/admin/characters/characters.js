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
    cardTemplate: '',
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
      this.loadCardTemplate();
      this.texts = await loadLocale(this.lang, 'characters');
      await this.loadLookups();
      await this.refresh();
    },
    loadCardTemplate() {
      const tpl = document.getElementById('character-card-template');
      this.cardTemplate = tpl ? tpl.innerHTML : '';
    },
    escapeHtml(str = '') {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    renderCharacterCard(ch, includeHistory = false) {
      if (!this.cardTemplate) this.loadCardTemplate();
      if (!this.cardTemplate) return '';
      const avatarUrl = this.characterAvatarUrl(ch);
      const initials = this.escapeHtml((ch.name || ch.id || '?').slice(0, 2).toUpperCase());
      const avatarBlock = avatarUrl
        ? `<img src="${this.escapeHtml(avatarUrl)}" class="h-full w-full object-cover" alt="">`
        : `<span>${initials}</span>`;
      const roleLabel = ch.role === 'npc' ? this.t('labels.npc','PNJ') : this.t('labels.pc','PJ');
      const hpLabel = `${ch.hpCurrent || 0} / ${ch.hpMax || 0} HP`;
      const hpPct = Math.max(0, Math.min(100, Math.round(((ch.hpCurrent || 0) / (ch.hpMax || 1)) * 100)));
      const metaHtml = '';
      const contextBlock = metaHtml
        ? `<div class="sw-story p-3.5 bg-white/98 dark:bg-slate-900/70 rounded-xl border border-slate-200/70 dark:border-slate-800/70 shadow-sm">
            <div class="sw-serif sw-smallcaps text-[11px] text-slate-500 dark:text-slate-400 mb-1">Contexte</div>
            <div class="text-sm text-slate-700 dark:text-slate-200 meta-slot">${metaHtml}</div>
          </div>`
        : '';
      const historyText = includeHistory ? (ch.history || this.t('noHistory',"Pas d'historique")) : '';
      const historyHtml = includeHistory ? this.escapeHtml(historyText) : '';
      const actions = `
        <button class="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-gray-700 text-slate-600 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                data-action="edit" data-id="${this.escapeHtml(ch.id)}" title="${this.t('actions.edit','Modifier')}" aria-label="${this.t('actions.edit','Modifier')}">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition"
                data-action="delete" data-id="${this.escapeHtml(ch.id)}" title="${this.t('actions.delete','Supprimer')}" aria-label="${this.t('actions.delete','Supprimer')}">
          <i class="fa-solid fa-trash"></i>
        </button>`;
      return this.cardTemplate
        .replace(/__AVATAR__/g, avatarBlock)
        .replace(/__NAME__/g, this.escapeHtml(ch.name || ch.id || ''))
        .replace(/__TYPE__/g, this.escapeHtml(ch.type || '—'))
        .replace(/__RACE__/g, this.escapeHtml(ch.race || ''))
        .replace(/__ROLE__/g, this.escapeHtml(roleLabel))
        .replace(/__HP__/g, this.escapeHtml(hpLabel))
        .replace(/__HPBAR__/g, `${hpPct}%`)
        .replace(/__HISTORY__/g, historyHtml)
        .replace(/__CONTEXT_BLOCK__/g, contextBlock)
        .replace(/__ACTIONS__/g, actions);
    },
    handleCardClick(evt) {
      const btn = evt.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;
      if (action === 'edit') {
        const ch = this.items.find(c => c.id === id);
        if (ch) this.openCharacterModal(ch);
      } else if (action === 'delete') {
        this.deleteCharacter(id);
      }
    },
    t(key, fallback) {
      return translate(this.texts, key, fallback);
    },
    ts(key, fallback) {
      return translate(this.texts, key, sanitizeFallback(fallback));
    },
    characterAvatarUrl(ch) {
      if (!ch?.avatar || !this.tenantId) return '';
      return `${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(ch.id)}/avatar`;
    },
    avatarThumbUrl(ch) {
      if (!ch?.avatar || !this.tenantId) return '';
      return `${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(ch.id)}/avatar-thumb`;
    },
    matchesFilters(ch) {
      const roleOk = this.filters.role ? (ch.role || '').toLowerCase() === this.filters.role.toLowerCase() : true;
      const sessionTerm = (this.filters.session || '').toLowerCase();
      const sessionOk = sessionTerm
        ? (
          (Array.isArray(ch.sessions) && ch.sessions.some(id => {
            const title = (this.sessionsIndex[id] || '').toLowerCase();
            return id.toLowerCase().includes(sessionTerm) || title.includes(sessionTerm);
          }))
          || ((this.scenariosIndex[ch.parentScenario] || '').toLowerCase().includes(sessionTerm))
        )
        : true;
      const q = (this.filters.query || '').toLowerCase();
      const queryOk = !q || (ch.name || '').toLowerCase().includes(q);
      return roleOk && sessionOk && queryOk;
    },
    scenarioTitle(id) {
      if (!id) return '';
      return this.scenariosIndex[id] || this.t('labels.unknownScenario', 'Scénario');
    },
    sessionTitles(ids = []) {
      if (!Array.isArray(ids) || !ids.length) return '';
      return ids.map(id => this.sessionsIndex[id] || this.t('labels.unknownSession', 'Session')).join(', ');
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
      const sessionNames = this.sessionTitles(sessions);
      const msg = sessions.length
        ? this.t('confirmDeleteWithSessions', 'Supprimer ce personnage ? Il est utilisé dans les sessions : {list}.')
            .replace('{list}', sessionNames)
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
            this.confirmModal = { open: false, message: '', onConfirm: null };
          } catch (_) {}
        }
      };
    }
  };
}

window.charactersPage = charactersPage;
