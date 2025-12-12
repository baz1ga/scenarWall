import { coreSection } from "../js/core.js";

export function gamesPage() {
  return {
    ...coreSection(),
    states: [],
    async init() {
      if (!this.isSuperAdmin) {
        window.location.href = "/admin/";
        return;
      }
      await this.fetchStates();
    },
    async fetchStates() {
      try {
        const res = await fetch("/api/admin/session-states", { headers: this.headersAuth() });
        if (!res.ok) throw new Error("states");
        const data = await res.json();
        this.states = Array.isArray(data) ? data : [];
      } catch (e) {
        this.states = [];
      }
    },
    formatDuration(state) {
      const started = state.createdAt ? Number(state.createdAt) : null;
      const updated = state.updatedAt ? Number(state.updatedAt) : null;
      if (!started || !updated) return "—";
      const diffMs = Math.max(0, updated - started);
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      const pad = (n) => n.toString().padStart(2, "0");
      return `${pad(mins)}:${pad(secs)}`;
    }
  };
}

window.gamesPage = gamesPage;
