export function gallerySection() {
  return {
    // state
    visible: [],
    hidden: [],
    order: [],
    dragIndex: null,
    dragOverIndex: null,
    selectedVisible: [],
    selectedHidden: [],
    galleryLoading: true,
    uploadMessage: '',
    uploadStatus: 'ok',
    uploadModalOpen: false,
    uploadTab: 'drop',
    uploadDragActive: false,
    uploadUrl: '',
    uploadUrlMessage: '',
    uploadUrlStatus: 'ok',
    uploadUrlLoading: false,
    pixabayKey: window.PIXABAY_KEY || '',
    pixabayQuery: '',
    pixabayLoading: false,
    pixabayResults: [],
    pixabayMessage: '',
    pixabayStatus: 'ok',
    pixabayInitialized: false,

    async refreshGallery() {
      if (!this.tenantId) return;
      this.galleryLoading = true;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/images`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Images');
        const data = await res.json();
        this.visible = data.filter(i => !i.hidden);
        this.hidden = data.filter(i => i.hidden);
        this.order = data.map(i => i.name);
        this.selectedVisible = this.selectedVisible.filter(name => this.visible.some(v => v.name === name));
        this.selectedHidden = this.selectedHidden.filter(name => this.hidden.some(h => h.name === name));
      } catch (e) {
        this.visible = [];
        this.hidden = [];
        this.selectedVisible = [];
        this.selectedHidden = [];
      }
      this.galleryLoading = false;
    },
    openUploadModal() {
      this.uploadModalOpen = true;
      this.uploadTab = 'drop';
      this.uploadDragActive = false;
    },
    closeUploadModal() {
      this.uploadModalOpen = false;
      this.uploadDragActive = false;
    },
    setUploadTab(tab) {
      this.uploadTab = tab;
      this.uploadUrlMessage = '';
      this.uploadUrlStatus = 'ok';
      this.pixabayMessage = '';
      this.pixabayStatus = 'ok';
      if (tab === 'pixabay' && !this.pixabayInitialized && !this.pixabayLoading) {
        if (!this.pixabayKey) {
          this.pixabayMessage = 'Clé API Pixabay manquante. Ajoutez-la dans global.json.';
          this.pixabayStatus = 'error';
          return;
        }
        this.searchPixabay(true);
      }
    },
    handleUploadDrop(event) {
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files || []);
      this.uploadDragActive = false;
      if (!files.length) return;
      this.uploadFile(files);
    },
    async uploadFile(eventOrFiles) {
      const files = Array.isArray(eventOrFiles)
        ? Array.from(eventOrFiles)
        : Array.from(eventOrFiles?.target?.files || []);
      if (eventOrFiles?.target) eventOrFiles.target.value = '';
      if (!files.length || !this.tenantId) return;

      let success = 0;
      let errors = [];

      for (const file of files) {
        const form = new FormData();
        form.append('image', file);
        try {
          const res = await fetch(`${this.API}/api/${this.tenantId}/images/upload`, {
            method: 'POST',
            headers: this.headersAuth(),
            body: form
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            if (res.status === 400 && data.error === 'Quota exceeded') {
              errors.push(`Quota dépassé pour ${file.name}`);
              break;
            }
            errors.push(data.error || `Échec pour ${file.name}`);
          } else {
            success++;
          }
        } catch (err) {
          errors.push(`Réseau: ${file.name}`);
        }
      }

      if (success > 0) {
        await this.refreshGallery();
        await this.fetchQuota();
        this.closeUploadModal();
      } else {
        await this.fetchQuota();
      }

      if (errors.length === 0) {
        this.setUpload(`${success} image${success > 1 ? 's' : ''} uploadée${success > 1 ? 's' : ''} avec succès.`, 'ok');
      } else {
        const msg = [
          success > 0 ? `${success} image${success > 1 ? 's' : ''} ok.` : 'Aucune image envoyée.',
          errors.join(' | ')
        ].join(' ');
        this.setUpload(msg, 'error');
      }
    },
    async uploadFromUrl(urlOverride = '') {
      const targetUrl = urlOverride || this.uploadUrl;
      if (!targetUrl || !this.tenantId) return;
      this.uploadUrlLoading = true;
      this.uploadUrlMessage = '';
      this.uploadUrlStatus = 'ok';
      try {
        const res = await fetch(targetUrl, { mode: 'cors' }).catch(() => null);
        if (!res || !res.ok) throw new Error('Impossible de récupérer le fichier.');
        const blob = await res.blob();
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) throw new Error('Le lien ne pointe pas vers une image.');
        const urlPath = targetUrl.split('/').pop() || 'image';
        const extFromType = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        const safeName = urlPath.match(/[^?#]+/)?.[0] || `remote.${extFromType}`;
        const fileName = safeName.includes('.') ? safeName : `${safeName}.${extFromType}`;
        const file = new File([blob], fileName, { type: contentType || 'image/jpeg' });
        await this.uploadFile([file]);
        this.uploadUrlMessage = 'Image importée avec succès.';
        this.uploadUrlStatus = 'ok';
        this.uploadUrl = '';
      } catch (err) {
        this.uploadUrlMessage = err.message || 'Import depuis URL impossible.';
        this.uploadUrlStatus = 'error';
      }
      this.uploadUrlLoading = false;
    },
    async searchPixabay(allowEmpty = false) {
      if (!this.pixabayKey) return;
      const qTrim = this.pixabayQuery.trim();
      if (!qTrim && !allowEmpty) return;
      this.pixabayLoading = true;
      this.pixabayMessage = '';
      this.pixabayStatus = 'ok';
      try {
        const url = new URL('https://pixabay.com/api/');
        url.searchParams.set('key', this.pixabayKey);
        url.searchParams.set('image_type', 'all');
        url.searchParams.set('per_page', '30');
        url.searchParams.set('orientation', 'horizontal');
        url.searchParams.set('safesearch', 'true');
        if (qTrim) {
          url.searchParams.set('q', qTrim);
        } else {
          url.searchParams.set('editors_choice', 'true');
          url.searchParams.set('order', 'popular');
        }

        const res = await fetch(url.toString()).catch(() => null);
        if (!res || !res.ok) throw new Error('Recherche impossible sur Pixabay.');
        const data = await res.json();
        if (!Array.isArray(data.hits)) {
          const errMsg = data?.error || data?.message || 'Réponse Pixabay invalide.';
          throw new Error(errMsg);
        }
        const hits = data.hits;
        this.pixabayResults = hits.filter(h => h.type === 'photo' || h.type === 'illustration');
        if (this.pixabayResults.length === 0) {
          this.pixabayMessage = 'Aucun résultat.';
          this.pixabayStatus = 'error';
        } else {
          this.pixabayInitialized = true;
        }
      } catch (err) {
        this.pixabayResults = [];
        this.pixabayMessage = err.message || 'Erreur Pixabay.';
        this.pixabayStatus = 'error';
      }
      this.pixabayLoading = false;
    },
    async importPixabay(url) {
      if (!url) return;
      this.pixabayMessage = '';
      this.pixabayStatus = 'ok';
      await this.uploadFromUrl(url);
      if (this.uploadUrlStatus === 'ok') {
        this.pixabayMessage = 'Image importée depuis Pixabay.';
        this.pixabayStatus = 'ok';
      } else {
        this.pixabayMessage = this.uploadUrlMessage || 'Import Pixabay impossible.';
        this.pixabayStatus = 'error';
      }
    },
    setUpload(msg, status = 'ok') {
      this.uploadMessage = msg;
      this.uploadStatus = status;
    },
    reorderOrderFromVisible(newVisibleOrder) {
      const hiddenSet = new Set(this.hidden.map(i => i.name));
      const baseOrder = this.order && this.order.length ? [...this.order] : [];

      if (!baseOrder.length) {
        const hiddenNames = this.hidden.map(i => i.name);
        return [...newVisibleOrder, ...hiddenNames];
      }

      const merged = [];
      let visibleIndex = 0;

      for (const name of baseOrder) {
        if (hiddenSet.has(name)) {
          merged.push(name);
        } else {
          merged.push(newVisibleOrder[visibleIndex++] || name);
        }
      }

      while (visibleIndex < newVisibleOrder.length) {
        merged.push(newVisibleOrder[visibleIndex++]);
      }

      return merged;
    },
    async persistVisibleOrder(newVisibleList) {
      const newVisibleOrder = newVisibleList.map(i => i.name);
      this.order = this.reorderOrderFromVisible(newVisibleOrder);
      this.visible = newVisibleList;
      await this.saveOrder();
    },
    startDrag(index) {
      this.dragIndex = index;
      this.dragOverIndex = index;
    },
    onDragOver(index) {
      if (this.dragIndex === null) return;
      this.dragOverIndex = index;
    },
    async onDrop(index) {
      if (this.dragIndex === null) return;
      const list = [...this.visible];
      const [moved] = list.splice(this.dragIndex, 1);
      list.splice(index, 0, moved);
      this.dragIndex = null;
      this.dragOverIndex = null;
      await this.persistVisibleOrder(list);
    },
    endDrag() {
      this.dragIndex = null;
      this.dragOverIndex = null;
    },
    async saveOrder() {
      await fetch(`${this.API}/api/${this.tenantId}/images/order`, {
        method: 'PUT',
        headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: this.order })
      });
    },
    async move(index, dir) {
      const newIndex = index + dir;
      if (newIndex < 0 || newIndex >= this.visible.length) return;
      const list = [...this.visible];
      [list[index], list[newIndex]] = [list[newIndex], list[index]];
      await this.persistVisibleOrder(list);
    },
    toggleSelectVisible(name) {
      if (this.selectedVisible.includes(name)) {
        this.selectedVisible = this.selectedVisible.filter(n => n !== name);
      } else {
        this.selectedVisible = [...this.selectedVisible, name];
      }
    },
    toggleSelectHidden(name) {
      if (this.selectedHidden.includes(name)) {
        this.selectedHidden = this.selectedHidden.filter(n => n !== name);
      } else {
        this.selectedHidden = [...this.selectedHidden, name];
      }
    },
    async hideSelectedVisible() {
      if (!this.selectedVisible.length) return;
      const names = [...this.selectedVisible];
      for (const name of names) {
        await fetch(`${this.API}/api/${this.tenantId}/images/hide/${name}`, { method: 'PUT', headers: this.headersAuth() });
      }
      this.selectedVisible = [];
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async hideImage(name) {
      this.selectedVisible = this.selectedVisible.filter(n => n !== name);
      await fetch(`${this.API}/api/${this.tenantId}/images/hide/${name}`, { method: 'PUT', headers: this.headersAuth() });
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async showImage(name) {
      this.selectedHidden = this.selectedHidden.filter(n => n !== name);
      await fetch(`${this.API}/api/${this.tenantId}/images/show/${name}`, { method: 'PUT', headers: this.headersAuth() });
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async deleteImage(name) {
      this.askConfirm('Supprimer définitivement cette image ?', async () => {
        this.selectedHidden = this.selectedHidden.filter(n => n !== name);
        await fetch(`${this.API}/api/${this.tenantId}/images/${name}`, { method: 'DELETE', headers: this.headersAuth() });
        await this.refreshGallery();
        await this.fetchQuota();
      });
    },
    async showSelectedHidden() {
      if (!this.selectedHidden.length) return;
      const names = [...this.selectedHidden];
      for (const name of names) {
        await fetch(`${this.API}/api/${this.tenantId}/images/show/${name}`, { method: 'PUT', headers: this.headersAuth() });
      }
      this.selectedHidden = [];
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async deleteSelectedHidden() {
      if (!this.selectedHidden.length) return;
      const names = [...this.selectedHidden];
      this.askConfirm(`Supprimer définitivement ${names.length} image${names.length > 1 ? 's' : ''} ?`, async () => {
        for (const name of names) {
          await fetch(`${this.API}/api/${this.tenantId}/images/${name}`, { method: 'DELETE', headers: this.headersAuth() });
        }
        this.selectedHidden = [];
        await this.refreshGallery();
        await this.fetchQuota();
      });
    },
    zoom(url) { this.zoomUrl = url; },
    openFront() {
      if (!this.tenantId) return;
      window.open(`/t/${this.tenantId}/front`, '_blank');
    },
    formatBytes(bytes) {
      if (bytes === null || bytes === undefined) return '';
      const units = ['o', 'Ko', 'Mo'];
      let val = bytes;
      let i = 0;
      while (val >= 1024 && i < units.length - 1) {
        val = val / 1024;
        i++;
      }
      return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    },
  };
}
