import { coreSection } from "../js/core.js";

export function gamesPage() {
  const base = coreSection();
  const baseInit = base.init;

  return {
    ...base,

    section: "games",
    states: [],
    searchTerm: "",
    hideShortRuns: true,
    loading: false,
    allOpen: false,

    // Tri "games"
    gamesSort: { key: "duration", dir: "desc" }, // key: tenant|session|date|duration

    async init() {
      if (typeof baseInit === "function") {
        await baseInit.call(this);
      }
      await this.fetchStates();
    },

    async fetchStates() {
      this.loading = true;
      try {
        const res = await fetch("/api/admin/session-states", {
          headers: this.headersAuth(),
        });
        if (!res.ok) throw new Error("states");
        const data = await res.json();
        this.states = this.normalizeGroups(data);
      } catch (e) {
        this.states = [];
      } finally {
        this.loading = false;
      }
    },

    normalizeGroups(data) {
      if (!Array.isArray(data)) return [];
      // already tenant grouped
      if (data.length && Array.isArray(data[0]?.sessions)) return data;

      const tmap = new Map();
      data.forEach((item) => {
        if (!item?.tenantId || !item?.sessionId) return;
        if (!tmap.has(item.tenantId))
          tmap.set(item.tenantId, { tenantId: item.tenantId, sessions: [] });

        const tenant = tmap.get(item.tenantId);
        let session = tenant.sessions.find((s) => s.sessionId === item.sessionId);
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
      return runs.filter((r) => {
        if (!this.hideShortRuns) return true;
        const start = Number(r.createdAt || 0);
        const end = Number(r.updatedAt || 0);
        if (!start || !end) return false;
        return end - start >= 300000; // >= 5 min
      });
    },

    // Clique sur un en-tête du tableau
    setUserSort(key) {
      if (!this.gamesSort) this.gamesSort = { key: "duration", dir: "desc" };
      if (this.gamesSort.key === key) {
        this.gamesSort.dir = this.gamesSort.dir === "asc" ? "desc" : "asc";
      } else {
        this.gamesSort.key = key;
        this.gamesSort.dir = key === "tenant" || key === "session" ? "asc" : "desc";
      }
    },

    // Icônes de tri
    sortIcon(key, mode) {
      const conf =
        mode === "games"
          ? this.gamesSort
          : mode === "users"
            ? this.userSort
            : this.quotaSort;

      if (!conf || conf.key !== key) return "fa-solid fa-sort text-slate-400";
      return conf.dir === "asc"
        ? "fa-solid fa-sort-up text-emerald-500"
        : "fa-solid fa-sort-down text-emerald-500";
    },

    durationMs(state) {
      const started = state?.createdAt ? Number(state.createdAt) : 0;
      const updated = state?.updatedAt ? Number(state.updatedAt) : 0;
      if (!started || !updated || updated < started) return 0;
      return updated - started;
    },

    groupedRuns() {
      const groups = this.states
        .map((t) => ({
          tenantId: t.tenantId,
          sessions: (t.sessions || [])
            .map((s) => ({
              sessionId: s.sessionId,
              runs: this.filterRuns(s.runs || []),
            }))
            .sort((a, b) => (a.sessionId || "").localeCompare(b.sessionId || "")),
        }))
        .sort((a, b) => (a.tenantId || "").localeCompare(b.tenantId || ""));

      return groups;
    },

    filteredTenants() {
      const q = (this.searchTerm || "").toLowerCase();
      return this.groupedRuns().filter(
        (t) => !q || (t.tenantId || "").toLowerCase().includes(q),
      );
    },

    flatRuns() {
      const flat = [];
      (this.states || []).forEach((t) => {
        (t.sessions || []).forEach((s) => {
          this.filterRuns(s.runs || []).forEach((r) => {
            flat.push({
              tenantId: t.tenantId,
              sessionId: s.sessionId,
              ...r,
            });
          });
        });
      });

      const key = this.gamesSort?.key || "duration";
      const dir = this.gamesSort?.dir === "asc" ? 1 : -1;

      const getVal = (r) => {
        if (key === "tenant") return r.tenantId || "";
        if (key === "session") return r.sessionId || "";
        if (key === "date") return Number(r.updatedAt || r.createdAt || 0);
        if (key === "duration") return this.durationMs(r);
        return "";
      };

      return flat.sort((a, b) => {
        const va = getVal(a);
        const vb = getVal(b);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    },

    formatDuration(state) {
      const diffMs = this.durationMs(state);
      if (!diffMs) return "—";
      const hours = Math.floor(diffMs / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      const pad = (n) => n.toString().padStart(2, "0");
      return `${pad(hours)}:${pad(mins)}`;
    },
  };
}

window.gamesPage = gamesPage;