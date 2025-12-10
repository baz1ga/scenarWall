import { coreSection } from '/admin/js/core.js';

export function gmDashboard() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    section: 'gm',
    playlist: [],
    playlistLoading: false,
    playlistError: '',
    slideshowImages: [],
    slideshowIndex: 0,
    slideshowLoading: false,
    slideshowError: '',
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
    notesId: null,
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
      this.notesTextarea.addEventListener('input', () => this.queueNotesSave());
      this.loadNotes();
    },
    async loadNotes() {
      if (!this.tenantId) return;
      this.notesLoading = true;
      try {
        const res = await fetch(`${this.API}/api/${this.tenantId}/session/notes`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Notes');
        const data = await res.json();
        this.notesId = data.id || null;
        this.notesContent = data.content || '';
        if (this.notesTextarea) this.notesTextarea.value = this.notesContent;
      } catch (e) {
        this.notesContent = '';
        if (this.notesTextarea) this.notesTextarea.value = '';
      } finally {
        this.notesLoading = false;
      }
    },
    queueNotesSave() {
      if (!this.tenantId) return;
      if (this.notesSaveTimer) clearTimeout(this.notesSaveTimer);
      this.notesSaveTimer = setTimeout(() => this.saveNotes(), 700);
    },
    async saveNotes() {
      if (!this.tenantId) return;
      this.notesSaveTimer = null;
      this.notesSaving = true;
      const content = this.notesTextarea ? this.notesTextarea.value : this.notesContent;
      try {
        const body = { content };
        if (this.notesId) body.id = this.notesId;
        const res = await fetch(`${this.API}/api/${this.tenantId}/session/notes`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.id) this.notesId = data.id;
        this.notesContent = content;
      } catch (_) {
        // silent failure to keep UX responsive
      } finally {
        this.notesSaving = false;
      }
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
      if (!this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/${this.tenantId}/session`, { headers: this.headersAuth() });
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
      if (!this.tenantId) return;
      try {
        await fetch(`${this.API}/api/${this.tenantId}/session/timer`, {
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
      this.timerRunning = false;
      this.timerElapsedMs = 0;
      this.timerStartedAt = null;
      this.stopTimerLoop();
      await this.saveTimer();
    },
    async toggleTimer() {
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
      if (!this.tenantId) return;
      try {
        await fetch(`${this.API}/api/${this.tenantId}/session/hourglass`, {
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
      if (!this.tenantId) {
        this.slideshowImages = [];
        return;
      }
      this.slideshowLoading = true;
      this.slideshowError = '';
      try {
        const res = await fetch(`/t/${this.tenantId}/api/images`);
        if (!res.ok) throw new Error('Impossible de charger les images');
        const data = await res.json();
        const visible = Array.isArray(data)
          ? data
              .filter(img => img.hidden !== true && img.visible !== false)
              .map(img => ({ ...img, displayUrl: img.thumbUrl || img.url }))
          : [];
        this.slideshowImages = visible;
        this.slideshowIndex = 0;
        this.sendSlideshow(0);
      } catch (e) {
        this.slideshowImages = [];
        this.slideshowError = e.message || 'Erreur de chargement';
      }
      this.slideshowLoading = false;
    },
    currentSlide() {
      if (!this.slideshowImages.length) return null;
      return this.slideshowImages[this.slideshowIndex] || null;
    },
    prevSlideObj() {
      if (!this.slideshowImages.length) return null;
      const idx = (this.slideshowIndex - 1 + this.slideshowImages.length) % this.slideshowImages.length;
      return this.slideshowImages[idx] || null;
    },
    nextSlideObj() {
      if (!this.slideshowImages.length) return null;
      const idx = (this.slideshowIndex + 1) % this.slideshowImages.length;
      return this.slideshowImages[idx] || null;
    },
    setSlide(index) {
      if (!this.slideshowImages.length) return;
      const len = this.slideshowImages.length;
      const safeIndex = ((index % len) + len) % len;
      this.slideshowIndex = safeIndex;
      this.sendSlideshow(safeIndex);
    },
    prevSlide() {
      this.setSlide(this.slideshowIndex - 1);
    },
    nextSlide() {
      this.setSlide(this.slideshowIndex + 1);
    },

    async loadTensionConfig() {
      if (!this.tenantId) {
        this.tensionEnabled = false;
        this.tensionLevels = [];
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/${this.tenantId}/config`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Config');
        const data = await res.json();
        this.tensionEnabled = !!data.tensionEnabled;
        const colors = data.tensionColors || {};
        const labels = data.tensionLabels || {};
        this.tensionAudio = data.tensionAudio || {};
        const defaults = {
          level1: '#37aa32',
          level2: '#f8d718',
          level3: '#f39100',
          level4: '#e63027',
          level5: '#3a3a39'
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
        this.tensionLevels = names.map((key, idx) => ({
          key,
          label: labels[key] || `L${idx+1}`,
          color: colors[key] || defaults[key],
          textColor: pickTextColor(colors[key] || defaults[key])
        }));
      } catch (e) {
        this.tensionEnabled = false;
        this.tensionLevels = [];
        this.tensionAudio = {};
      }
    },

    async loadPlaylist() {
      if (!this.tenantId) {
        this.playlist = [];
        return;
      }
      this.playlistLoading = true;
      this.playlistError = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/audio`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Impossible de charger la playlist');
        this.playlist = await res.json();
      } catch (e) {
        this.playlist = [];
        this.playlistError = e.message || 'Erreur de chargement';
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
      await this.loadTensionConfig();
      await this.loadPlaylist();
      await this.loadSlideshow();
      await this.loadTimer();
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
      };
      ws.onclose = () => {
        this.socketTimer = setTimeout(() => this.connectSocket(), 2000);
      };
      ws.onerror = () => {
        ws.close();
      };
      ws.onmessage = () => {};
    },

    sendTension(levelKey) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        this.socket.send(JSON.stringify({ type: 'tension:update', level: levelKey }));
      } catch (e) {
        // ignore send errors
      }
    },
    sendSlideshow(index) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        this.socket.send(JSON.stringify({ type: 'slideshow:update', index }));
      } catch (e) {
        // ignore
      }
    },

    async playTension(levelKey) {
      this.selectedTension = levelKey;
       this.sendTension(levelKey);
      const name = this.tensionAudio[levelKey];
      if (!name) return;
      if (!this.playlist.length) {
        await this.loadPlaylist();
      }
      const track = this.playlist.find(a => a.name === name);
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
