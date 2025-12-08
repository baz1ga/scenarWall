import { coreSection } from '/admin/js/core.js';
import { audioSection } from '/admin/audio/audio.js';

export function tensionSection() {
  return {
    tensionEnabled: true,
    tensionFont: 'Audiowide',
    defaultTensionColors: {
      level1: '#37aa32',
      level2: '#f8d718',
      level3: '#f39100',
      level4: '#e63027',
      level5: '#3a3a39'
    },
    defaultTensionLabels: {
      level1: '0',
      level2: '-5',
      level3: '+5',
      level4: '+10',
      level5: '+15'
    },
    tensionColors: {
      level1: '#37aa32',
      level2: '#f8d718',
      level3: '#f39100',
      level4: '#e63027',
      level5: '#3a3a39'
    },
    tensionLabels: {
      level1: '0',
      level2: '-5',
      level3: '+5',
      level4: '+10',
      level5: '+15'
    },
    tensionAudio: {
      level1: null,
      level2: null,
      level3: null,
      level4: null,
      level5: null
    },
    tensionMessage: '',
    tensionStatus: 'ok',
    tensionSavedAt: null,

    normalizeLocalColors(colors) {
      const sanitize = (c, fallback) => {
        const val = this.sanitizeColor(c);
        return val ? val : fallback;
      };
      return {
        level1: sanitize(colors?.level1, this.defaultTensionColors.level1),
        level2: sanitize(colors?.level2, this.defaultTensionColors.level2),
        level3: sanitize(colors?.level3, this.defaultTensionColors.level3),
        level4: sanitize(colors?.level4, this.defaultTensionColors.level4),
        level5: sanitize(colors?.level5, this.defaultTensionColors.level5)
      };
    },
    async loadTension() {
      if (!this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/${this.tenantId}/config`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Config');
        const data = await res.json();
        this.tensionEnabled = data.tensionEnabled !== false;
        this.tensionFont = data.tensionFont ?? 'Audiowide';
        this.tensionColors = this.normalizeLocalColors(data.tensionColors);
        this.tensionLabels = this.normalizeLocalLabels(data.tensionLabels);
        this.tensionAudio = data.tensionAudio || { ...this.tensionAudio };
        this.tensionMessage = 'Configuration chargée.';
        this.tensionStatus = 'ok';
      } catch (err) {
        this.tensionColors = { ...this.defaultTensionColors };
        this.tensionLabels = { ...this.defaultTensionLabels };
        this.tensionMessage = 'Impossible de charger la configuration.';
        this.tensionStatus = 'error';
      }
    },
    sanitizeColor(hex) {
      const h = (hex || '').toString().trim().toLowerCase();
      const normalized = h.startsWith('#') ? h : `#${h}`;
      const short = normalized.match(/^#([0-9a-fA-F]{3})$/);
      if (short) {
        const c = short[1];
        return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`.toLowerCase();
      }
      return /^#([0-9a-fA-F]{6})$/.test(normalized) ? normalized : null;
    },
    normalizeLocalLabels(labels) {
      const clamp = (v, fb) => {
        if (typeof v !== 'string') return fb;
        const s = v.trim().slice(0, 4);
        return s.length ? s : fb;
      };
      const src = labels || {};
      return {
        level1: clamp(src.level1, this.defaultTensionLabels.level1),
        level2: clamp(src.level2, this.defaultTensionLabels.level2),
        level3: clamp(src.level3, this.defaultTensionLabels.level3),
        level4: clamp(src.level4, this.defaultTensionLabels.level4),
        level5: clamp(src.level5, this.defaultTensionLabels.level5),
      };
    },
    async toggleTension() {
      return this.saveTensionConfig();
    },
    async saveTensionConfig() {
      if (!this.tenantId) return;
      try {
        const colors = this.normalizeLocalColors(this.tensionColors);
        const labels = this.normalizeLocalLabels(this.tensionLabels);
        const res = await fetch(`${this.API}/api/${this.tenantId}/config/tension`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tensionEnabled: this.tensionEnabled,
            tensionFont: this.tensionFont,
            tensionColors: colors,
            tensionLabels: labels,
            tensionAudio: this.tensionAudio
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
        this.tensionEnabled = data.config?.tensionEnabled !== false;
        this.tensionFont = data.config?.tensionFont || null;
        this.tensionColors = data.config?.tensionColors || colors;
        this.tensionLabels = data.config?.tensionLabels || labels;
        this.tensionAudio = data.config?.tensionAudio || this.tensionAudio;
        this.tensionMessage = this.tensionEnabled ? 'Barre de tension activée.' : 'Barre de tension désactivée.';
        this.tensionStatus = 'ok';
        this.tensionSavedAt = new Date().toLocaleTimeString();
        setTimeout(() => { this.tensionSavedAt = null; }, 3000);
      } catch (err) {
        this.tensionMessage = err.message || 'Erreur réseau.';
        this.tensionStatus = 'error';
      }
    },
  };
}

export function tensionPage() {
  return {
    ...coreSection(),
    ...audioSection(),
    ...tensionSection(),
    section: 'tension'
  };
}

window.tensionPage = tensionPage;
