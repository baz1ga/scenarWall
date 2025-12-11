import { coreSection } from '/admin/js/core.js';

export function gmDashboard() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    section: 'gm',
    scenarioId: '',
    scenarioTitle: '',
    sessions: [],
    sessionLoading: false,
    sessionError: '',
    selectedSessionId: '',
    currentSession: null,
    showLeaveModal: false,
    leaveTarget: '',
    scenes: [],
    sceneLoading: false,
    sceneError: '',
    selectedSceneId: '',
    currentScene: null,
    sceneCarouselIndex: 0,
    playlist: [],
    playlistLoading: false,
    playlistError: '',
    slideshowImages: [],
    slideshowIndex: 0,
    slideshowCarouselEnabled: true,
    slideshowLoading: false,
    slideshowError: '',
    hasNextScene: false,
    timerRunning: false,
    timerElapsedMs: 0,
    timerStartedAt: null,
    _timerInterval: null,
    _timerTick: 0,
    tensionEnabled: false,
    tensionLevels: [],
    tensionAudio: {},
    selectedTension: '',
    hourglassDuration: 60,
    hourglassDurationTemp: 60,
    hourglassModalOpen: false,
    hourglassRunning: false,
    hourglassStartedAt: null,
    hourglassRemainingMs: 0,
    _hourglassInterval: null,
    hourglassVisible: false,
    hourglassShowTimer: false,
    socket: null,
    socketTimer: null,
    _tensionAudio: null,
    _pendingTensionSessionId: null,
    _pendingSlideshowSessionId: null,
    tenantImages: [],
    tenantAudio: [],
    notesContent: '',
    notesSaving: false,
    notesLoading: false,
    notesSaveTimer: null,
    noteInputBound: false,
    notesTextarea: null,
    initNotesEditor(el) {
      if (!el) return;
      this.notesTextarea = el;
      this.noteInputBound = true;
      this.notesTextarea.value = this.notesContent || '';
      this.notesTextarea.addEventListener('input', () => this.queueSceneNoteSave());
    },
    async loadSceneNote() {
      if (!this.tenantId || !this.selectedSceneId) {
        this.notesContent = '';
        if (this.notesTextarea) this.notesTextarea.value = '';
        return;
      }
      this.notesLoading = true;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.selectedSceneId)}/note`, {
          headers: this.headersAuth()
        });
        const data = res.ok ? await res.json() : {};
        const content = data?.content || '';
        this.notesContent = content;
        if (this.notesTextarea) this.notesTextarea.value = content;
      } catch (e) {
        this.notesContent = '';
        if (this.notesTextarea) this.notesTextarea.value = '';
      } finally {
        this.notesLoading = false;
      }
    },
    queueSceneNoteSave() {
      if (!this.tenantId || !this.selectedSceneId) return;
      if (this.notesSaveTimer) clearTimeout(this.notesSaveTimer);
      this.notesSaveTimer = setTimeout(() => this.saveSceneNote(), 700);
    },
    async saveSceneNote() {
      if (!this.tenantId || !this.selectedSceneId) return;
      this.notesSaveTimer = null;
      this.notesSaving = true;
      const content = this.notesTextarea ? this.notesTextarea.value : this.notesContent;
      try {
        await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.selectedSceneId)}/note`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        this.notesContent = content;
      } catch (_) {
        // silent failure to keep UX responsive
      } finally {
        this.notesSaving = false;
      }
    },
    async loadTenantImages() {
      if (!this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/images`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Images');
        const data = await res.json();
        this.tenantImages = Array.isArray(data) ? data : [];
      } catch (_) {
        this.tenantImages = [];
      }
    },
    async loadTenantAudio() {
      if (!this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/audio`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Audio');
        this.tenantAudio = await res.json();
      } catch (_) {
        this.tenantAudio = [];
      }
    },
    async fetchSessionsAndSelect() {
      if (!this.tenantId) return;
      this.sessionLoading = true;
      this.sessionError = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Sessions');
        const list = await res.json();
        this.sessions = Array.isArray(list) ? list : [];
        const params = new URLSearchParams(window.location.search);
        const sessionParam = params.get('session');
        const sceneParam = params.get('scene');
        const picked = this.sessions.find(s => s.id === sessionParam) || this.sessions[0] || null;
        if (picked) {
          await this.selectSession(picked.id, { preferredScene: sceneParam });
        }
      } catch (e) {
        this.sessionError = e?.message || 'Impossible de charger les sessions';
        this.sessions = [];
      } finally {
        this.sessionLoading = false;
      }
    },
    async selectSession(id, { preferredScene } = {}) {
      if (!id || !this.tenantId) return;
      this.selectedSessionId = id;
      this.selectedTension = '';
      this.currentSession = this.sessions.find(s => s.id === id) || null;
      this.scenarioId = this.currentSession?.parentScenario || '';
      this.scenarioTitle = '';
      this.selectedSceneId = '';
      this.currentScene = null;
      this.slideshowImages = [];
      this.playlist = [];
      await this.loadSessionData();
      await this.loadScenesForSession(id, preferredScene);
      this.fulfillPendingRequests();
    },
    async loadSessionData() {
      if (!this.tenantId || !this.selectedSessionId) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.selectedSessionId)}`, {
          headers: this.headersAuth()
        });
        if (res.ok) {
          const data = await res.json();
          const fallbackSession = this.sessions.find(s => s.id === this.selectedSessionId) || {};
          const labelsFromApi = data?.tensionLabels;
          const colorsFromApi = data?.tensionColors;
          const isEmptyObj = (obj) => obj && typeof obj === 'object' && Object.keys(obj).length === 0;
          if (!labelsFromApi || isEmptyObj(labelsFromApi)) {
            data.tensionLabels = fallbackSession.tensionLabels || data.tensionLabels;
          }
          if (!colorsFromApi || isEmptyObj(colorsFromApi)) {
            data.tensionColors = fallbackSession.tensionColors || data.tensionColors;
          }
          this.currentSession = data;
          this.scenarioId = data.parentScenario || '';
          if (this.scenarioId) {
            await this.fetchScenarioTitle(this.scenarioId);
          } else {
            this.scenarioTitle = '';
          }
          this.applySessionTension(data);
        } else {
          this.currentSession = null;
          this.tensionEnabled = false;
          this.tensionLevels = [];
          this.tensionAudio = {};
        }
      } catch (_) {
        this.currentSession = null;
        this.tensionEnabled = false;
        this.tensionLevels = [];
        this.tensionAudio = {};
      }
      await this.loadTimer();
    },
    async fetchScenarioTitle(id) {
      if (!id || !this.tenantId) {
        this.scenarioTitle = '';
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios/${encodeURIComponent(id)}`, {
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('scenario');
        const data = await res.json();
        this.scenarioTitle = data.title || id;
      } catch (_) {
        this.scenarioTitle = '';
      }
    },
    sanitizeColor(hex) {
      const h = (hex || '').toString().trim().toLowerCase();
      const normalized = h.startsWith('#') ? h : `#${h}`;
      const short = normalized.match(/^#([0-9a-f]{3})$/i);
      if (short) {
        const c = short[1];
        return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`.toLowerCase();
      }
      return /^#([0-9a-f]{6})$/i.test(normalized) ? normalized : null;
    },
    applySessionTension(session) {
      const defaults = {
        level1: '#37aa32',
        level2: '#f8d718',
        level3: '#f39100',
        level4: '#e63027',
        level5: '#3a3a39'
      };
      const colors = session?.tensionColors || {};
      const labels = session?.tensionLabels || {};
      const normalizeLabel = (val, fb) => {
        if (val === undefined || val === null) return fb;
        const s = String(val).trim();
        return s.length ? s : fb;
      };
      const names = ['level1','level2','level3','level4','level5'];
      const pickTextColor = (hex = '') => {
        const clean = hex.replace('#','');
        const full = clean.length === 3 ? clean.split('').map(c => c+c).join('') : clean.padEnd(6,'0');
        const num = parseInt(full, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        return luminance > 186 ? '#0f172a' : '#ffffff';
      };
      this.tensionEnabled = session?.tensionEnabled !== false;
      this.tensionAudio = session?.tensionAudio || {};
      this.tensionLevels = names.map((key, idx) => {
        const color = this.sanitizeColor(colors[key]) || defaults[key];
        return {
          key,
          // priorité aux labels de la session, sinon fallback Lx
          label: normalizeLabel(labels[key], `L${idx+1}`),
          color,
          textColor: pickTextColor(color)
        };
      });      
      this.sendTensionConfig();
      this.fulfillPendingRequests();
    },
    fulfillPendingRequests() {
      const targetTension = this._pendingTensionSessionId;
      const targetSlide = this._pendingSlideshowSessionId;
      if (this.selectedSessionId && (!targetTension || targetTension === this.selectedSessionId)) {
        this.sendTensionConfig();
        this._pendingTensionSessionId = null;
      }
      if (this.selectedSessionId && (!targetSlide || targetSlide === this.selectedSessionId)) {
        this.sendSlideshow(this.slideshowIndex);
        this._pendingSlideshowSessionId = null;
      }
    },
    sendTensionConfig() {
      if (!this.selectedSessionId) return;
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const cfg = {
        tensionEnabled: this.tensionEnabled,
        tensionFont: this.currentSession?.tensionFont || 'Audiowide',
        tensionColors: this.currentSession?.tensionColors || {},
        tensionLabels: this.currentSession?.tensionLabels || {},
        tensionAudio: this.currentSession?.tensionAudio || {}
      };
      console.log('[GM][WS] send tension:config', { sessionId: this.selectedSessionId, cfg });
      try {
        this.socket.send(JSON.stringify({ type: 'tension:config', config: cfg, sessionId: this.selectedSessionId }));
      } catch (e) {
        // ignore send errors
      }
    },
    sessionViewLink() {
      if (!this.selectedSessionId) return '#';
      return `/admin/sessions/view.html?id=${encodeURIComponent(this.selectedSessionId)}`;
    },
    confirmLeaveToSession() {
      if (!this.selectedSessionId) return;
      this.leaveTarget = this.sessionViewLink();
      this.showLeaveModal = true;
    },
    cancelLeave() {
      this.showLeaveModal = false;
      this.leaveTarget = '';
    },
    proceedLeave() {
      if (this.leaveTarget) {
        window.location.href = this.leaveTarget;
      }
      this.showLeaveModal = false;
      this.leaveTarget = '';
    },

    async loadScenesForSession(sessionId, preferredScene) {
      if (!this.tenantId || !sessionId) return;
      this.sceneLoading = true;
      this.sceneError = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Scènes');
        const all = await res.json();
        const filtered = Array.isArray(all)
          ? all.filter(sc => sc.parentSession === sessionId)
              .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.updatedAt || 0) - (b.updatedAt || 0))
          : [];
        this.scenes = filtered;
        const target = filtered.find(sc => sc.id === preferredScene) || filtered[0] || null;
        if (target) {
          await this.selectScene(target.id);
        } else {
          this.selectedSceneId = '';
          this.currentScene = null;
          this.sceneCarouselIndex = 0;
          this.slideshowImages = [];
          this.playlist = [];
          this.notesContent = '';
          if (this.notesTextarea) this.notesTextarea.value = '';
        }
      } catch (e) {
        this.sceneError = e?.message || 'Impossible de charger les scènes';
        this.scenes = [];
        this.selectedSceneId = '';
        this.currentScene = null;
        this.sceneCarouselIndex = 0;
        this.notesContent = '';
        if (this.notesTextarea) this.notesTextarea.value = '';
      } finally {
        this.sceneLoading = false;
      }
    },
    async selectScene(id) {
      this.selectedSceneId = id;
      this.currentScene = this.scenes.find(sc => sc.id === id) || null;
      this.ensureSceneVisible(id);
      this.slideshowLoading = true;
      this.playlistLoading = true;
      this.slideshowError = '';
      this.playlistError = '';
      try {
        if (!this.tenantImages.length) {
          await this.loadTenantImages();
        }
        this.buildSlideshowFromScene();
      } catch (e) {
        this.slideshowError = e?.message || 'Erreur diaporama';
        this.slideshowImages = [];
      } finally {
        this.slideshowLoading = false;
      }

      try {
        if (!this.tenantAudio.length) {
          await this.loadTenantAudio();
        }
        this.buildPlaylistFromScene();
      } catch (e) {
        this.playlistError = e?.message || 'Erreur playlist';
        this.playlist = [];
      } finally {
        this.playlistLoading = false;
      }

      await this.loadSceneNote();
    },
    ensureSceneVisible(sceneId) {
      if (!this.scenes.length) return;
      const idx = this.scenes.findIndex(sc => sc.id === sceneId);
      if (idx === -1) return;
      const maxStart = Math.max(0, this.scenes.length - 5);
      const target = Math.min(Math.max(idx - 2, 0), maxStart);
      this.sceneCarouselIndex = target;
    },
    carouselPrev() {
      this.sceneCarouselIndex = Math.max(0, this.sceneCarouselIndex - 1);
    },
    carouselNext() {
      const maxStart = Math.max(0, this.scenes.length - 5);
      this.sceneCarouselIndex = Math.min(maxStart, this.sceneCarouselIndex + 1);
    },
    buildSlideshowFromScene() {
      if (!this.currentScene) {
        this.slideshowImages = [];
        this.slideshowIndex = 0;
        this.slideshowCarouselEnabled = true;
        this.hasNextScene = false;
        return;
      }
      const mapped = (this.currentScene.images || [])
        .map((img, idx) => {
          const name = typeof img === 'string' ? img : img?.name;
          if (!name) return null;
          const ref = this.tenantImages.find(i => i.name === name) || {};
          const fallbackUrl = this.tenantId ? `/t/${this.tenantId}/images/${encodeURIComponent(name)}` : '';
          const url = ref.thumbUrl || ref.url || img?.url || fallbackUrl;
          if (!url) return null;
          return {
            name,
            url,
            displayUrl: url,
            order: typeof img?.order === 'number' ? img.order : idx + 1
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      const currentIdx = this.scenes.findIndex(sc => sc.id === this.selectedSceneId);
      this.hasNextScene = currentIdx !== -1 && currentIdx < this.scenes.length - 1;

      const virtualLength = mapped.length + (this.hasNextScene ? 1 : 0);
      this.slideshowCarouselEnabled = virtualLength > 2;
      this.slideshowImages = mapped;
      this.slideshowIndex = mapped.length ? 0 : 0;
      if (mapped.length) {
        this.setSlide(0);
      } else {
        this.sendSlideshow(0);
      }
    },
    buildPlaylistFromScene() {
      if (!this.currentScene) {
        this.playlist = [];
        return;
      }
      const mapped = (this.currentScene.audio || [])
        .map((item, idx) => {
          const name = typeof item === 'string' ? item : item?.name;
          if (!name) return null;
          const ref = this.tenantAudio.find(a => a.name === name);
          if (!ref) return null;
          const order = typeof item?.order === 'number' ? item.order : idx + 1;
          return { ...ref, order };
        })
        .filter(Boolean)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      this.playlist = mapped;
    },
    changeTension(delta) {
      const target = this.tensionTargetLevel(delta);
      if (target) this.playTension(target.key);
    },
    tensionTargetLevel(delta) {
      if (!this.tensionLevels.length) return null;
      const currentIdx = this.tensionLevels.findIndex(l => l.key === this.selectedTension);
      const baseIdx = currentIdx === -1 ? 0 : currentIdx;
      const nextIdx = Math.min(this.tensionLevels.length - 1, Math.max(0, baseIdx + delta));
      return this.tensionLevels[nextIdx] || null;
    },
    tensionButtonStyle(delta) {
      const lvl = this.tensionTargetLevel(delta);
      if (!lvl) return '';
      // slightly desaturate via opacity overlay
      return `background:${lvl.color}DD; border-color:${lvl.color}; color:${lvl.textColor};`;
    },
    tensionButtonLabel(delta) {
      const lvl = this.tensionTargetLevel(delta);
      return lvl ? lvl.label : '';
    },

    timerDisplay() {
      // consume tick to refresh Alpine reactivity
      void this._timerTick;
      const total = this.timerRunning && this.timerStartedAt
        ? this.timerElapsedMs + (Date.now() - this.timerStartedAt)
        : this.timerElapsedMs;
      const ms = Math.max(0, Math.floor(total));
      const sec = Math.floor(ms / 1000) % 60;
      const min = Math.floor(ms / 60000) % 60;
      const hrs = Math.floor(ms / 3600000);
      const pad = (n) => n.toString().padStart(2, '0');
      return `${pad(hrs)}:${pad(min)}:${pad(sec)}`;
    },
    timerParts() {
      void this._timerTick;
      const total = this.timerRunning && this.timerStartedAt
        ? this.timerElapsedMs + (Date.now() - this.timerStartedAt)
        : this.timerElapsedMs;
      const ms = Math.max(0, Math.floor(total));
      const sec = Math.floor(ms / 1000) % 60;
      const min = Math.floor(ms / 60000) % 60;
      const hrs = Math.floor(ms / 3600000);
      const pad = (n) => n.toString().padStart(2, '0');
      return { h: pad(hrs), m: pad(min), s: pad(sec) };
    },
    colonClass() {
      if (!this.timerRunning) return 'opacity-100';
      return (this._timerTick % 1000) < 500 ? 'opacity-100' : 'opacity-20';
    },
    startTimerLoop() {
      if (this._timerInterval) {
        clearInterval(this._timerInterval);
      }
      this._timerInterval = setInterval(() => {
        this._timerTick = Date.now();
      }, 500);
    },
    stopTimerLoop() {
      if (this._timerInterval) {
        clearInterval(this._timerInterval);
        this._timerInterval = null;
      }
    },
    async loadTimer() {
      if (!this.tenantId || !this.selectedSessionId) {
        this.timerRunning = false;
        this.timerElapsedMs = 0;
        this.timerStartedAt = null;
        this.stopTimerLoop();
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.selectedSessionId)}/gm-state`, {
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('timer');
        const data = await res.json();
        const timer = data.timer || {};
        this.timerRunning = !!timer.running;
        this.timerElapsedMs = typeof timer.elapsedMs === 'number' ? timer.elapsedMs : 0;
        this.timerStartedAt = timer.startedAt ? new Date(timer.startedAt).getTime() : null;
        if (data.hourglass) {
          const d = Number(data.hourglass.durationSeconds);
          if (Number.isFinite(d) && d > 0) {
            this.hourglassDuration = d;
            this.hourglassDurationTemp = d;
          }
          if (typeof data.hourglass.showTimer === 'boolean') {
            this.hourglassShowTimer = data.hourglass.showTimer;
          }
        }
        if (this.timerRunning && !this.timerStartedAt) {
          this.timerStartedAt = Date.now();
        }
        if (this.timerRunning) {
          this.startTimerLoop();
        } else {
          this.stopTimerLoop();
        }
      } catch (e) {
        this.timerRunning = false;
        this.timerElapsedMs = 0;
        this.timerStartedAt = null;
        this.stopTimerLoop();
      }
    },
    async saveTimer() {
      if (!this.tenantId || !this.selectedSessionId) return;
      try {
        await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.selectedSessionId)}/timer`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            running: this.timerRunning,
            elapsedMs: this.timerElapsedMs,
            startedAt: this.timerStartedAt ? new Date(this.timerStartedAt).toISOString() : null
          })
        });
      } catch (e) {
        // ignore
      }
    },
    async resetTimer() {
      if (!this.selectedSessionId) return;
      this.timerRunning = false;
      this.timerElapsedMs = 0;
      this.timerStartedAt = null;
      this.stopTimerLoop();
      await this.saveTimer();
    },
    async toggleTimer() {
      if (!this.selectedSessionId) return;
      if (!this.timerRunning) {
        this.timerStartedAt = Date.now();
        this.timerRunning = true;
        this.startTimerLoop();
      } else {
        const now = Date.now();
        if (this.timerStartedAt) {
          this.timerElapsedMs += now - this.timerStartedAt;
        }
        this.timerStartedAt = null;
        this.timerRunning = false;
        this.stopTimerLoop();
      }
      await this.saveTimer();
    },

    normalizeHourglassDuration(val) {
      const n = Number(val);
      return Number.isFinite(n) && n > 0 ? n : this.hourglassDuration;
    },
    startHourglassLoop(durationMs) {
      if (this._hourglassInterval) clearInterval(this._hourglassInterval);
      this.hourglassRunning = true;
      this.hourglassRemainingMs = durationMs;
      this.hourglassStartedAt = Date.now();
      this._hourglassInterval = setInterval(() => {
        if (!this.hourglassRunning || !this.hourglassStartedAt) return;
        const elapsed = Date.now() - this.hourglassStartedAt;
        const remaining = Math.max(0, durationMs - elapsed);
        this.hourglassRemainingMs = remaining;
        if (remaining === 0) {
          this.stopHourglassLoop();
        }
      }, 500);
    },
    stopHourglassLoop() {
      this.hourglassRunning = false;
      this.hourglassStartedAt = null;
      if (this._hourglassInterval) {
        clearInterval(this._hourglassInterval);
        this._hourglassInterval = null;
      }
    },
    sendHourglass(action, payload = {}) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        if (action === 'showTimer' && payload.show === undefined) {
          payload.show = !!this.hourglassShowTimer;
        }
        if (action === 'visibility' || action === 'flip' || action === 'play') {
          payload.durationSeconds = this.normalizeHourglassDuration(this.hourglassDuration);
          payload.show = !!this.hourglassShowTimer;
        }
        this.socket.send(JSON.stringify({ type: 'hourglass:command', action, ...payload }));
      } catch (e) {
        // ignore send errors
      }
    },
    toggleHourglassVisibility() {
      this.hourglassVisible = !this.hourglassVisible;
      this.sendHourglass('visibility', { visible: this.hourglassVisible });
      this.sendHourglass('showTimer', { show: this.hourglassVisible ? !!this.hourglassShowTimer : false });
    },
    playOrResetHourglass() {
      const duration = this.normalizeHourglassDuration(this.hourglassDuration);
      this.hourglassDuration = duration;
      if (!this.hourglassRunning) {
        this.hourglassVisible = true;
        this.sendHourglass('visibility', { visible: true });
        this.sendHourglass('showTimer', { show: !!this.hourglassShowTimer });
        this.sendHourglass('play', { durationSeconds: duration });
        this.startHourglassLoop(duration * 1000);
      } else {
        this.stopHourglassLoop();
        this.sendHourglass('reset', { durationSeconds: duration });
      }
    },
    hourglassButtonLabel() {
      return this.hourglassRunning ? 'Stop' : 'Lancer';
    },
    openHourglassModal() {
      this.hourglassDurationTemp = this.hourglassDuration;
      this.hourglassModalOpen = true;
    },
    closeHourglassModal() {
      this.hourglassModalOpen = false;
    },
    applyHourglassDuration() {
      const duration = this.normalizeHourglassDuration(this.hourglassDurationTemp);
      this.hourglassDuration = duration;
      this.hourglassModalOpen = false;
      this.sendHourglass('setDuration', { durationSeconds: duration });
      this.saveHourglassPrefs();
      // Pas de flip auto, juste mise à jour de la durée
    },
    async saveHourglassPrefs() {
      if (!this.tenantId || !this.selectedSessionId) return;
      try {
        await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.selectedSessionId)}/hourglass`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            durationSeconds: this.hourglassDuration,
            showTimer: !!this.hourglassShowTimer
          })
        });
      } catch (e) {
        // ignore
      }
    },
    hourglassDisplay() {
      if (!this.hourglassRunning) return 'Durée';
      const ms = Math.max(0, Math.floor(this.hourglassRemainingMs));
      const sec = Math.ceil(ms / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const pad = (n) => n.toString().padStart(2, '0');
      return `${m}:${pad(s)}`;
    },

    async loadSlideshow() {
      this.slideshowLoading = true;
      this.slideshowError = '';
      try {
        if (!this.tenantImages.length) {
          await this.loadTenantImages();
        }
        this.buildSlideshowFromScene();
      } catch (e) {
        this.slideshowImages = [];
        this.slideshowError = e?.message || 'Erreur de chargement';
      }
      this.slideshowLoading = false;
    },
    currentSlide() {
      if (!this.slideshowImages.length) return null;
      return this.slideshowImages[this.slideshowIndex] || null;
    },
    prevSlideObj() {
      if (!this.slideshowImages.length) return null;
      const idx = this.slideshowIndex - 1;
      if (idx < 0) return null;
      return this.slideshowImages[idx] || null;
    },
    nextSlideObj() {
      if (!this.slideshowImages.length) return null;
      const idx = this.slideshowIndex + 1;
      if (idx >= this.slideshowImages.length) return null;
      return this.slideshowImages[idx] || null;
    },
    setSlide(index) {
      if (!this.slideshowImages.length) return;
      const len = this.slideshowImages.length;
      const safeIndex = Math.min(Math.max(index, 0), len - 1);
      this.slideshowIndex = safeIndex;
      this.sendSlideshow(safeIndex);
    },
    prevSlide() {
      if (this.slideshowIndex > 0) {
        this.setSlide(this.slideshowIndex - 1);
      }
    },
    nextSlide() {
      if (!this.slideshowImages.length) {
        if (this.hasNextScene) {
          const currentIdx = this.scenes.findIndex(sc => sc.id === this.selectedSceneId);
          const nextScene = currentIdx >= 0 && currentIdx < this.scenes.length - 1 ? this.scenes[currentIdx + 1] : null;
          if (nextScene) this.selectScene(nextScene.id);
        }
        return;
      }
      const nextIdx = this.slideshowIndex + 1;
      if (nextIdx < this.slideshowImages.length) {
        this.setSlide(nextIdx);
      } else if (this.hasNextScene) {
        const currentIdx = this.scenes.findIndex(sc => sc.id === this.selectedSceneId);
        const nextScene = currentIdx >= 0 && currentIdx < this.scenes.length - 1 ? this.scenes[currentIdx + 1] : null;
        if (nextScene) this.selectScene(nextScene.id);
      }
    },

    async loadTensionConfig() {
      if (!this.tenantId || !this.selectedSessionId) {
        this.tensionEnabled = false;
        this.tensionLevels = [];
        return;
      }
      if (!this.currentSession || this.currentSession.id !== this.selectedSessionId) {
        await this.loadSessionData();
        return;
      }
      this.applySessionTension(this.currentSession);
    },

    async loadPlaylist() {
      this.playlistLoading = true;
      this.playlistError = '';
      try {
        if (!this.tenantAudio.length) {
          await this.loadTenantAudio();
        }
        this.buildPlaylistFromScene();
      } catch (e) {
        this.playlist = [];
        this.playlistError = e?.message || 'Erreur de chargement';
      }
      this.playlistLoading = false;
    },

    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      this.section = 'gm';
      this.breadcrumb = 'Game Master';
      this.connectSocket();
      await Promise.all([this.loadTenantImages(), this.loadTenantAudio()]);
      await this.fetchSessionsAndSelect();
    },

    connectSocket() {
      if (!this.tenantId) return;
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws?tenantId=${encodeURIComponent(this.tenantId)}&role=gm`);
      this.socket = ws;
      ws.onopen = () => {
        if (this.socketTimer) {
          clearTimeout(this.socketTimer);
          this.socketTimer = null;
        }
        if (this.selectedSessionId) {
          this.sendTensionConfig();
          this.sendSlideshow(this.slideshowIndex);
        } else {
          // pas encore de session sélectionnée, on traitera la requête quand selectSession aura fini
          this._pendingTensionSessionId = true;
          this._pendingSlideshowSessionId = true;
        }
      };
      ws.onclose = () => {
        this.socketTimer = setTimeout(() => this.connectSocket(), 2000);
      };
      ws.onerror = () => {
        ws.close();
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data || '{}');
          if (msg.type === 'tension:request') {
            if (!msg.sessionId || msg.sessionId === this.selectedSessionId) {
              this.sendTensionConfig();
            } else {
              this._pendingTensionSessionId = msg.sessionId;
            }
          }
          if (msg.type === 'slideshow:request') {
            if (!msg.sessionId || msg.sessionId === this.selectedSessionId) {
              this.sendSlideshow(this.slideshowIndex);
            } else {
              this._pendingSlideshowSessionId = msg.sessionId;
            }
          }
        } catch (_) {
          // ignore parse errors
        }
      };
    },

    sendTension(levelKey) {
      if (!this.selectedSessionId) return;
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        this.socket.send(JSON.stringify({ type: 'tension:update', level: levelKey, sessionId: this.selectedSessionId }));
      } catch (e) {
        // ignore send errors
      }
    },
    sendSlideshow(index) {
      if (!this.selectedSessionId) return;
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      if (!this.slideshowImages.length) return;
      const len = this.slideshowImages.length;
      const safeIndex = len > 0 ? Math.min(Math.max(index, 0), len - 1) : 0;
      const slide = len > 0 ? (this.slideshowImages[safeIndex] || null) : null;
      if (!slide) return;
      try {
        this.socket.send(JSON.stringify({
          type: 'slideshow:update',
          name: slide.name || null,
          sessionId: this.selectedSessionId
        }));
        console.log('[GM][WS] send slideshow:update', { name: slide?.name, sessionId: this.selectedSessionId });
      } catch (e) {
        // ignore
      }
    },
    openFront() {
      if (!this.tenantId) return;
      const sessionParam = this.selectedSessionId ? `?session=${encodeURIComponent(this.selectedSessionId)}` : '';
      window.open(`/t/${this.tenantId}/front${sessionParam}`, '_blank');
    },

    async playTension(levelKey) {
      this.selectedTension = levelKey;
       this.sendTension(levelKey);
      const name = this.tensionAudio[levelKey];
      if (!name) return;
      if (!this.tenantAudio.length) {
        await this.loadTenantAudio();
      }
      const track = this.tenantAudio.find(a => a.name === name);
      if (!track) return;
      try {
        if (this._tensionAudio) {
          this._tensionAudio.pause();
        }
        const player = new Audio(track.url);
        this._tensionAudio = player;
        await player.play();
      } catch (e) {
        // ignore play errors
      }
    }
  };
}

window.gmDashboard = gmDashboard;

// Alpine a besoin de l'exposer en global
window.gmDashboard = gmDashboard;
