import { coreSection } from '/admin/js/core.js';

export function audioSection() {
  return {
    audioFiles: [],
    audioLoading: false,
    audioMessage: '',
    audioStatus: 'ok',
    selectedAudio: [],
    audioDragIndex: null,
    audioDragOverIndex: null,
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
          errors.push(`Réseau: ${file.name}`);
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
        this.audioMessage = `${success} fichier${success > 1 ? 's' : ''} ajouté${success > 1 ? 's' : ''}.`;
      } else {
        const msg = [
          success > 0 ? `${success} fichier${success > 1 ? 's' : ''} ok.` : 'Aucun fichier ajouté.',
          errors.join(' | ')
        ].join(' ');
        this.audioMessage = msg;
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
      const impactLabel = impacted > 0 ? ` (${impacted} scène${impacted > 1 ? 's' : ''} impactée${impacted > 1 ? 's' : ''})` : '';
      this.askConfirm(`Supprimer définitivement ${names.length} audio${names.length > 1 ? 's' : ''}${impactLabel} ?`, async () => {
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
            this.audioMessage = `${scenesUpdatedTotal} scène${scenesUpdatedTotal > 1 ? 's' : ''} nettoyée${scenesUpdatedTotal > 1 ? 's' : ''}.`;
            this.audioStatus = 'ok';
          }
        } catch (err) {
          this.audioMessage = 'Suppression impossible.';
          this.audioStatus = 'error';
        }
      });
    },
    async deleteAudio(name) {
      this.selectedAudio = this.selectedAudio.filter(n => n !== name);
      const impacted = await this.countAudioUsage([name]);
      const impactLabel = impacted > 0 ? ` (${impacted} scène${impacted > 1 ? 's' : ''} impactée${impacted > 1 ? 's' : ''})` : '';
      this.askConfirm(`Supprimer définitivement cet audio${impactLabel} ?`, async () => {
        try {
          const res = await fetch(`${this.API}/api/${this.tenantId}/audio/${encodeURIComponent(name)}`, { method: 'DELETE', headers: this.headersAuth() });
          const data = await res.json().catch(() => ({}));
          await this.loadAudio();
          await this.fetchQuota();
          const scenesUpdated = data?.scenesUpdated || 0;
          if (scenesUpdated > 0) {
            this.audioMessage = `${scenesUpdated} scène${scenesUpdated > 1 ? 's' : ''} nettoyée${scenesUpdated > 1 ? 's' : ''}.`;
            this.audioStatus = 'ok';
          }
        } catch (err) {
          this.audioMessage = 'Suppression impossible.';
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
        this.renameAudioModal.error = newName ? 'Le nom est identique.' : 'Entrez un nom.';
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
        this.audioMessage = 'Nom mis à jour.';
        this.audioStatus = 'ok';
      } catch (err) {
        this.renameAudioModal.error = err.message || 'Impossible de renommer.';
        this.audioStatus = 'error';
      }
    },
  };
}

export function audioPage() {
  return {
    ...coreSection(),
    ...audioSection(),
    section: 'audio'
  };
}

window.audioPage = audioPage;
