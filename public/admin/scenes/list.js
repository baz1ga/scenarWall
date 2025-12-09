import { coreSection } from '/admin/js/core.js';

export function scenesListSection(baseInit) {
  return {
    loading: true,
    error: '',
    scenes: [],
    parentSession: null,
    parentScenario: null,
    sessionTitle: '',
    scenarioTitle: '',
    breadcrumb: 'Scénarios > Sessions > Scènes',
    headerTitle: 'Scènes',
    headerSubtitle: '',
    dirtyOrder: false,
    confirmModal: { open: false, item: null, message: '' },

    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      this.section = 'scenarios';
      const params = new URLSearchParams(window.location.search || '');
      this.parentSession = params.get('session') || null;
      if (this.parentSession) {
        this.headerTitle = `Scènes de la session ${this.parentSession}`;
        this.headerSubtitle = 'Réordonner ou modifier les scènes';
        await this.fetchSessionInfo(this.parentSession);
      }
      await this.fetchScenes();
    },

    async fetchSessionInfo(id) {
      if (!this.tenantId || !id) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(id)}`, { headers: this.headersAuth() });
        if (!res.ok) return;
        const data = await res.json();
        this.sessionTitle = data.title || id;
        this.parentScenario = data.parentScenario || null;
        this.headerTitle = `Scènes de ${this.sessionTitle}`;
        this.headerSubtitle = data.parentScenario ? `Session du scénario ${data.parentScenario}` : '';
        if (this.parentScenario) {
          this.fetchScenarioTitle(this.parentScenario);
        } else {
          this.breadcrumb = `Scénarios > Sessions > ${this.sessionTitle}`;
        }
      } catch (err) {
        this.breadcrumb = `Scénarios > Sessions > ${id}`;
      }
    },

    async fetchScenarioTitle(id) {
      if (!this.tenantId || !id) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios/${encodeURIComponent(id)}`, { headers: this.headersAuth() });
        if (!res.ok) return;
        const data = await res.json();
        this.scenarioTitle = data.title || id;
        this.breadcrumb = `Scénarios > ${this.scenarioTitle} > Scènes`;
      } catch (err) {
        this.breadcrumb = `Scénarios > ${id} > Scènes`;
      }
    },

    async fetchScenes() {
      if (!this.tenantId) {
        this.loading = false;
        return;
      }
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Impossible de charger les scènes');
        let list = await res.json();
        if (this.parentSession) {
          list = list.filter(s => s.parentSession === this.parentSession);
        }
        list.sort((a, b) => {
          const orderDiff = (a.order || 0) - (b.order || 0);
          if (orderDiff !== 0) return orderDiff;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        this.scenes = list;
      } catch (err) {
        this.error = err?.message || 'Erreur de chargement';
        this.scenes = [];
      } finally {
        this.loading = false;
        this.dirtyOrder = false;
      }
    },

    moveScene(fromIdx, toIdx) {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= this.scenes.length || toIdx >= this.scenes.length) return;
      const arr = [...this.scenes];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      this.scenes = arr.map((scene, idx) => ({ ...scene, order: idx + 1 }));
      this.dirtyOrder = true;
    },

    async saveOrder() {
      if (!this.dirtyOrder || !this.tenantId) return;
      try {
        const order = this.scenes.map(s => s.id);
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ order })
        });
        if (!res.ok) {
          if (res.status === 404) {
            await this.saveOrderFallback();
          } else {
            throw new Error('Réordonner a échoué');
          }
        }
        this.dirtyOrder = false;
      } catch (err) {
        this.error = err?.message || 'Erreur de réordonnancement';
      }
    },

    async saveOrderFallback() {
      // Fallback si l’endpoint /scenes/reorder n’existe pas sur l’instance en cours
      for (const scene of this.scenes) {
        try {
          await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(scene.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
            body: JSON.stringify(scene)
          });
        } catch (e) {
          // on essaie quand même pour les autres
        }
      }
    },

    deleteScene(item) {
      if (!item || !item.id) return;
      this.confirmModal = {
        open: true,
        item,
        message: `Supprimer la scène "${item.title || item.id}" ?`
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
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('Suppression impossible');
        await this.fetchScenes();
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la suppression';
      }
    }
  };
}

export function scenesListPage() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    ...scenesListSection(baseInit)
  };
}

window.scenesListPage = scenesListPage;
