import { coreSection } from "../js/core.js";

export function gamesPage() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    section: 'games',
    states: [],
    searchTerm: '',
    hideShortRuns: true,
    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      await this.fetchStates();
    },
    async fetchStates() {
      try {
        const res = await fetch("/api/admin/session-states", { headers: this.headersAuth() });
        if (!res.ok) throw new Error("states");
        const data = await res.json();
        this.states = this.normalizeGroups(data);
      } catch (e) {
        this.states = [];
      }
    },
    normalizeGroups(data) {
      if (!Array.isArray(data)) return [];
      // already tenant grouped
      if (data.length && Array.isArray(data[0]?.sessions)) return data;
      const tmap = new Map();
      data.forEach(item => {
        if (!item?.tenantId || !item?.sessionId) return;
        if (!tmap.has(item.tenantId)) tmap.set(item.tenantId, { tenantId: item.tenantId, sessions: [] });
        const tenant = tmap.get(item.tenantId);
        let session = tenant.sessions.find(s => s.sessionId === item.sessionId);
        if (!session) {
          session = { sessionId: item.sessionId, runs: [] };
          tenant.sessions.push(session);
        }
        if (Array.isArray(item.runs)) {
          session.runs.push(...item.runs);
        } else {
          const { tenantId, sessionId, ...rest } = item;
          session.runs.push(rest);
        }
      });
      return Array.from(tmap.values());
    },
    filterRuns(runs = []) {
      return runs.filter(r => {
        if (!this.hideShortRuns) return true;
        const start = Number(r.createdAt || 0);
        const end = Number(r.updatedAt || 0);
        if (!start || !end) return false;
        return (end - start) >= 60000; // au moins 60s
      });
    },
    groupedRuns() {
      const groups = this.states.map(t => ({
        tenantId: t.tenantId,
        sessions: (t.sessions || []).map(s => ({
          sessionId: s.sessionId,
          runs: this.filterRuns((s.runs || [])).slice().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        })).sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      })).sort((a, b) => a.tenantId.localeCompare(b.tenantId));
      return groups;
    },
    filteredTenants() {
      const q = (this.searchTerm || '').toLowerCase();
      return this.groupedRuns().filter(t => !q || (t.tenantId || '').toLowerCase().includes(q));
    },
    flatRuns() {
      const flat = [];
      (this.states || []).forEach(t => {
        (t.sessions || []).forEach(s => {
          this.filterRuns(s.runs || []).forEach(r => {
            flat.push({
              tenantId: t.tenantId,
              sessionId: s.sessionId,
              ...r
            });
          });
        });
      });
      return flat.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    },
    formatDuration(state) {
      const started = state.createdAt ? Number(state.createdAt) : null;
      const updated = state.updatedAt ? Number(state.updatedAt) : null;
      if (!started || !updated) return "—";
      const diffMs = Math.max(0, updated - started);
      const hours = Math.floor(diffMs / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      const pad = (n) => n.toString().padStart(2, "0");
      return `${pad(hours)}:${pad(mins)}`;
    }
  };
}

window.gamesPage = gamesPage;
