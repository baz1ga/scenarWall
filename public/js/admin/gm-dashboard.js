import { coreSection } from './core.js';

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
    tensionEnabled: false,
    tensionLevels: [],
    tensionAudio: {},
    selectedTension: '',
    socket: null,
    socketTimer: null,
    _tensionAudio: null,
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
      return lvl ? `background:${lvl.color}; border-color:${lvl.color}; color:${lvl.textColor};` : '';
    },
    tensionButtonLabel(delta) {
      const lvl = this.tensionTargetLevel(delta);
      return lvl ? lvl.label : '';
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
        const visible = Array.isArray(data) ? data.filter(img => img.hidden !== true && img.visible !== false) : [];
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

// Alpine a besoin de l'exposer en global
window.gmDashboard = gmDashboard;
