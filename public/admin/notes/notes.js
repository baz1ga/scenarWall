import { coreSection } from '/admin/js/core.js';
import { loadLocale, t as translate } from '/admin/js/i18n.js';

function formatDate(ts) {
  if (!ts) return '';
  const val = Number(ts);
  const date = new Date((String(val).length === 13 ? val : val * 1000));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function notesPage() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    section: 'notes',
    loading: true,
    notes: [],
    scenarios: [],
    sessions: [],
    scenes: [],
    initialSceneParam: '',
    showEditModal: false,
    showDeleteModal: false,
    activeNote: null,
    editContent: "",
    lang: localStorage.getItem("lang") || (navigator.language || "fr").slice(0, 2) || "fr",
    texts: {},

    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      const params = new URLSearchParams(window.location.search || '');
      this.initialSceneParam = params.get('scene') || '';
      this.texts = await loadLocale(this.lang, "notes");
      await Promise.all([
        this.fetchScenarios(),
        this.fetchSessions(),
        this.fetchScenes(),
        this.fetchNotes()
      ]);
      this.loading = false;
    },

    async fetchNotes() {
      if (!this.tenantId) {
        this.notes = [];
        return;
      }
      try {
        const res = await fetch(`/t/${this.tenantId}/api/notes`);
        if (!res.ok) throw new Error('Notes');
        const data = await res.json();
        this.notes = Array.isArray(data) ? data : [];
      } catch (e) {
        this.notes = [];
      }
    },

    async fetchScenarios() {
      if (!this.tenantId) {
        this.scenarios = [];
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios`, { headers: this.headersAuth() });
        this.scenarios = res.ok ? await res.json() : [];
      } catch (_) {
        this.scenarios = [];
      }
    },

    async fetchSessions() {
      if (!this.tenantId) {
        this.sessions = [];
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions`, { headers: this.headersAuth() });
        this.sessions = res.ok ? await res.json() : [];
      } catch (_) {
        this.sessions = [];
      }
    },

    async fetchScenes() {
      if (!this.tenantId) {
        this.scenes = [];
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, { headers: this.headersAuth() });
        this.scenes = res.ok ? await res.json() : [];
      } catch (_) {
        this.scenes = [];
      }
    },

    groupedNotes() {
      const scenariosById = Object.fromEntries(this.scenarios.map(s => [s.id, s]));
      const sessionsById = Object.fromEntries(this.sessions.map(s => [s.id, s]));
      const scenesCountBySession = {};
      this.scenes.forEach(scene => {
        if (scene?.parentSession) {
          scenesCountBySession[scene.parentSession] = (scenesCountBySession[scene.parentSession] || 0) + 1;
        }
      });
      const noteUsage = {};

      this.scenes.forEach(scene => {
        const noteName = scene?.notes;
        if (!noteName) return;
        noteUsage[noteName] = {
          sessionId: scene.parentSession || null,
          scenarioId: scene.parentScenario || sessionsById[scene.parentSession]?.parentScenario || null,
          sceneId: scene.id || null,
          sceneTitle: scene.title || scene.id || '',
          sceneOrder: typeof scene.order === "number" ? scene.order : 0
        };
      });

      const scenarios = {};
      const unlinked = [];

      (this.notes || []).forEach(n => {
        const link = noteUsage[n.name];
        if (!link || !link.sessionId || !link.scenarioId) {
          unlinked.push({ ...n, sessionId: null, scenarioId: null });
          return;
        }
        const scn = scenariosById[link.scenarioId];
        const sess = sessionsById[link.sessionId];
        if (!scn || !sess) {
          unlinked.push({ ...n, sessionId: link.sessionId, scenarioId: link.scenarioId });
          return;
        }
        if (!scenarios[scn.id]) {
          scenarios[scn.id] = { scenario: scn, sessions: {} };
        }
        if (!scenarios[scn.id].sessions[sess.id]) {
          scenarios[scn.id].sessions[sess.id] = {
            session: sess,
            notes: [],
            singleScene: (scenesCountBySession[sess.id] || 0) <= 1
          };
        }
        scenarios[scn.id].sessions[sess.id].notes.push({
          ...n,
          sessionId: sess.id,
          sceneId: link.sceneId,
          sceneTitle: link.sceneTitle,
          sceneOrder: link.sceneOrder
        });
      });

      return {
        scenarios: Object.values(scenarios).map(scn => {
          const sessionEntries = Object.values(scn.sessions);
          const multiSessions = sessionEntries.filter(s => !s.singleScene).map(sess => ({
            ...sess,
            notes: sess.notes
              .map(n => ({
                ...n,
                sessionId: sess.session.id,
                sceneId: n.sceneId,
                sceneTitle: n.sceneTitle || n.name
              }))
              .sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0))
          }));

          const singleSceneNotes = sessionEntries
            .filter(s => s.singleScene)
            .flatMap(sess => sess.notes.map(n => ({
              ...n,
              sceneTitle: sess.session.title || n.sceneTitle || n.name,
              sessionTitle: sess.session.title || "",
              sessionId: sess.session.id,
              sceneId: n.sceneId
            })))
            .sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0));

          return {
            scenario: scn.scenario,
            sessions: multiSessions,
            singleSceneNotes
          };
        }),
        unlinked
      };
    },

    async openEdit(note) {
      if (!this.tenantId || !note) return;
      this.activeNote = note;
      try {
        const res = await fetch(`/t/${this.tenantId}/notes/${encodeURIComponent(note.name)}`, {
          headers: this.headersAuth()
        });
        this.editContent = res.ok ? await res.text() : "";
      } catch (_) {
        this.editContent = "";
      }
      this.showEditModal = true;
    },

    async saveEdit() {
      if (!this.tenantId || !this.activeNote) return;
      try {
        await fetch(`/t/${this.tenantId}/notes/${encodeURIComponent(this.activeNote.name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...this.headersAuth() },
          body: JSON.stringify({ content: this.editContent })
        });
        await this.fetchNotes();
      } catch (_) {
        // ignore
      } finally {
        this.showEditModal = false;
        this.activeNote = null;
        this.editContent = "";
      }
    },

    openDelete(note) {
      this.activeNote = note;
      this.showDeleteModal = true;
    },

    async confirmDelete() {
      if (!this.tenantId || !this.activeNote) return;
      try {
        await fetch(`/t/${this.tenantId}/notes/${encodeURIComponent(this.activeNote.name)}`, {
          method: "DELETE",
          headers: this.headersAuth()
        });
        await this.fetchNotes();
      } catch (_) {
        // ignore
      } finally {
        this.showDeleteModal = false;
        this.activeNote = null;
      }
    },

    cancelModals() {
      this.showEditModal = false;
      this.showDeleteModal = false;
      this.activeNote = null;
      this.editContent = "";
    },

    t(key, fallback) {
      return translate(this.texts, key, fallback);
    },

    formatDate
  };
}

window.notesPage = notesPage;
