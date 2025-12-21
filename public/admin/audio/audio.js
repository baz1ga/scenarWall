import { coreSection } from '/admin/js/core.js';
import { loadLocale, t as translate } from '/admin/js/i18n.js';

export function audioSection() {
  return {
    audioFiles: [],
    audioLoading: false,
    audioMessage: '',
    audioStatus: 'ok',
    selectedAudio: [],
    audioDragIndex: null,
    audioDragOverIndex: null,
    lang: localStorage.getItem("lang") || (navigator.language || "fr").slice(0, 2) || "fr",
    texts: {},
    renameAudioModal: {
      open: false,
      name: '',
      newName: '',
      error: ''
    },

    async countAudioUsage(names = []) {
      if (!this.tenantId || !names.length) return 0;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, { headers: this.headersAuth() });
        if (!res.ok) return 0;
        const scenes = await res.json();
        let count = 0;
        scenes.forEach(scene => {
          const list = Array.isArray(scene.audio) ? scene.audio : [];
          const hasMatch = list.some(item => {
            const name = typeof item === 'string' ? item : item?.name;
            return names.includes(name);
          });
          if (hasMatch) count++;
        });
        return count;
      } catch (e) {
        return 0;
      }
    },

    async loadAudio() {
      if (!this.tenantId) return;
      this.audioLoading = true;
      if (!this.texts || !Object.keys(this.texts).length) {
        this.texts = await loadLocale(this.lang, "audio");
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/audio`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Audio');
        this.audioFiles = await res.json();
        this.audioStatus = 'ok';
        this.selectedAudio = this.selectedAudio.filter(name => this.audioFiles.some(a => a.name === name));
      } catch (e) {
        this.audioFiles = [];
        this.audioStatus = 'error';
        this.selectedAudio = [];
      }
      this.audioLoading = false;
    },
    t(key, fallback) {
      return translate(this.texts, key, fallback);
    },
    async uploadAudio(event) {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length || !this.tenantId) return;
      let success = 0;
      const errors = [];
      for (const file of files) {
        if (file.size > 1 * 1024 * 1024) {
          errors.push(`${file.name} dépasse 1 Mo`);
          continue;
        }
        const form = new FormData();
        form.append('audio', file);
        try {
          const res = await fetch(`${this.API}/api/${this.tenantId}/audio/upload`, {
            method: 'POST',
            headers: this.headersAuth(),
            body: form
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            errors.push(data.error || `Échec pour ${file.name}`);
          } else {
            success++;
          }
        } catch (err) {
          errors.push(this.t("messages.errors", `Réseau: ${file.name}`));
        }
      }
      if (success > 0) {
        await this.loadAudio();
        await this.fetchQuota();
      } else {
        await this.fetchQuota();
      }
      this.audioStatus = errors.length ? 'error' : 'ok';
      if (errors.length === 0) {
        const key = "messages.added";
        this.audioMessage = this.t(key, `${success} fichier${success > 1 ? 's' : ''} ajouté${success > 1 ? 's' : ''}.`).replace("{count}", success);
      } else {
        const base = success > 0 ? this.t("messages.added", `${success} fichier${success > 1 ? 's' : ''} ok.`).replace("{count}", success) : this.t("messages.errors", "Aucun fichier ajouté.");
        this.audioMessage = [base, errors.join(' | ')].join(' ');
      }
    },
    toggleSelectAudio(name) {
      if (this.selectedAudio.includes(name)) {
        this.selectedAudio = this.selectedAudio.filter(n => n !== name);
      } else {
        this.selectedAudio = [...this.selectedAudio, name];
      }
    },
    async persistAudioOrder(list) {
      this.audioFiles = list;
      const order = list.map(a => a.name);
      await fetch(`${this.API}/api/${this.tenantId}/audio/order`, {
        method: 'PUT',
        headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });
    },
    startAudioDrag(index) {
      this.audioDragIndex = index;
      this.audioDragOverIndex = index;
    },
    onAudioDragOver(index) {
      if (this.audioDragIndex === null) return;
      this.audioDragOverIndex = index;
    },
    async onAudioDrop(index) {
      if (this.audioDragIndex === null) return;
      const list = [...this.audioFiles];
      const [moved] = list.splice(this.audioDragIndex, 1);
      list.splice(index, 0, moved);
      this.audioDragIndex = null;
      this.audioDragOverIndex = null;
      await this.persistAudioOrder(list);
    },
    endAudioDrag() {
      this.audioDragIndex = null;
      this.audioDragOverIndex = null;
    },
    async deleteSelectedAudio() {
      if (!this.selectedAudio.length) return;
      const names = [...this.selectedAudio];
      const impacted = await this.countAudioUsage(names);
      const impactLabel = impacted > 0 ? this.t("confirm.impact", ` (${impacted} scène${impacted > 1 ? 's' : ''} impactée${impacted > 1 ? 's' : ''})`).replace("{count}", impacted).replace("{plural}", impacted > 1 ? "s" : "") : '';
      const msg = this.t("confirm.deleteMany", `Supprimer définitivement ${names.length} audio${names.length > 1 ? 's' : ''}${impactLabel} ?`)
        .replace("{count}", names.length)
        .replace("{plural}", names.length > 1 ? "s" : "")
        .replace("{impact}", impactLabel || "");
      this.askConfirm(msg, async () => {
        try {
          let scenesUpdatedTotal = 0;
          for (const name of names) {
            const res = await fetch(`${this.API}/api/${this.tenantId}/audio/${encodeURIComponent(name)}`, { method: 'DELETE', headers: this.headersAuth() });
            const data = await res.json().catch(() => ({}));
            if (data?.scenesUpdated) scenesUpdatedTotal += data.scenesUpdated;
          }
          this.selectedAudio = [];
          await this.loadAudio();
          await this.fetchQuota();
          if (scenesUpdatedTotal > 0) {
            this.audioMessage = this.t("messages.deletedScenes", `${scenesUpdatedTotal} scène${scenesUpdatedTotal > 1 ? 's' : ''} nettoyée${scenesUpdatedTotal > 1 ? 's' : ''}.`).replace("{count}", scenesUpdatedTotal);
            this.audioStatus = 'ok';
          }
        } catch (err) {
          this.audioMessage = this.t("messages.deleteFailed", "Suppression impossible.");
          this.audioStatus = 'error';
        }
      });
    },
    async deleteAudio(name) {
      this.selectedAudio = this.selectedAudio.filter(n => n !== name);
      const impacted = await this.countAudioUsage([name]);
      const impactLabel = impacted > 0 ? this.t("confirm.impact", ` (${impacted} scène${impacted > 1 ? 's' : ''} impactée${impacted > 1 ? 's' : ''})`).replace("{count}", impacted).replace("{plural}", impacted > 1 ? "s" : "") : '';
      const msg = this.t("confirm.deleteOne", `Supprimer définitivement cet audio${impactLabel} ?`)
        .replace("{impact}", impactLabel || "")
        .replace("{count}", impacted)
        .replace("{plural}", impacted > 1 ? "s" : "");
      this.askConfirm(msg, async () => {
        try {
          const res = await fetch(`${this.API}/api/${this.tenantId}/audio/${encodeURIComponent(name)}`, { method: 'DELETE', headers: this.headersAuth() });
          const data = await res.json().catch(() => ({}));
          await this.loadAudio();
          await this.fetchQuota();
          const scenesUpdated = data?.scenesUpdated || 0;
          if (scenesUpdated > 0) {
            this.audioMessage = this.t("messages.deletedScenes", `${scenesUpdated} scène${scenesUpdated > 1 ? 's' : ''} nettoyée${scenesUpdated > 1 ? 's' : ''}.`).replace("{count}", scenesUpdated);
            this.audioStatus = 'ok';
          }
        } catch (err) {
          this.audioMessage = this.t("messages.deleteFailed", "Suppression impossible.");
          this.audioStatus = 'error';
        }
      });
    },
    async renameAudio(name) {
      this.openRenameAudioModal(name);
    },
    openRenameAudioModal(name) {
      this.renameAudioModal = {
        open: true,
        name,
        newName: name,
        error: ''
      };
    },
    closeRenameAudioModal() {
      this.renameAudioModal = { open: false, name: '', newName: '', error: '' };
    },
    async confirmRenameAudio() {
      const { name, newName } = this.renameAudioModal;
      if (!newName || newName === name) {
        this.renameAudioModal.error = newName ? this.t("renameDialog.sameName", "Le nom est identique.") : this.t("renameDialog.empty", "Entrez un nom.");
        return;
      }
      this.renameAudioModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/${this.tenantId}/audio/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Erreur');
        this.closeRenameAudioModal();
        await this.loadAudio();
        this.audioMessage = this.t("messages.renameOk", "Nom mis à jour.");
        this.audioStatus = 'ok';
      } catch (err) {
        this.renameAudioModal.error = err.message || this.t("messages.renameFail", "Impossible de renommer.");
        this.audioStatus = 'error';
      }
    },
  };
}

export function audioPage() {
  return {
    ...coreSection(),
    ...audioSection(),
    section: 'audio',
    async init() {
      const baseInit = coreSection().init;
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      // Recharge les traductions audio après la langue tenant/localStorage.
      this.texts = await loadLocale(this.lang, 'audio');
      await this.loadAudio();
    }
  };
}

window.audioPage = audioPage;
