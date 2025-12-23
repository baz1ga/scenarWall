import { coreSection } from '/admin/js/core.js';
import { uploadModalMixin } from '/admin/js/upload-modal.js';
import { loadLocale, t as translate } from '/admin/js/i18n.js';

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
    lang: localStorage.getItem("lang") || (navigator.language || "fr").slice(0, 2) || "fr",
    texts: {},
    ...uploadModalMixin({
      async onFilesSelected(files) {
        return this.uploadImages(files);
      }
    }),

    async loadTexts() {
      this.texts = await loadLocale(this.lang, "gallery");
    },
    t(key, fallback) {
      return translate(this.texts, key, fallback);
    },

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
    async countImageUsage(names = []) {
      if (!this.tenantId || !Array.isArray(names) || names.length === 0) return 0;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, { headers: this.headersAuth() });
        if (!res.ok) return 0;
        const scenes = await res.json();
        if (!Array.isArray(scenes)) return 0;
        const target = new Set(names);
        return scenes.reduce((acc, sc) => {
          const images = Array.isArray(sc?.images) ? sc.images : [];
          const uses = images.some(img => target.has(img?.name));
          return acc + (uses ? 1 : 0);
        }, 0);
      } catch (err) {
        return 0;
      }
    },
    async uploadImages(eventOrFiles) {
      const files = Array.isArray(eventOrFiles)
        ? Array.from(eventOrFiles)
        : Array.from(eventOrFiles?.target?.files || []);
      if (eventOrFiles?.target) eventOrFiles.target.value = '';
      if (!files.length || !this.tenantId) return false;

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
              errors.push(this.t("messages.quotaExceeded", `Quota dépassé pour ${file.name}`).replace("{name}", file.name));
              break;
            }
            const errMsg = data.error ? data.error : this.t("messages.uploadError", `Échec pour ${file.name}`).replace("{name}", file.name);
            errors.push(errMsg);
          } else {
            success++;
          }
        } catch (err) {
          errors.push(this.t("messages.networkError", `Réseau : ${file.name}`).replace("{name}", file.name));
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
        this.setUpload(this.t("messages.uploadSuccess", `${success} image${success > 1 ? 's' : ''} uploadée${success > 1 ? 's' : ''} avec succès.`).replace("{count}", success), 'ok');
      } else {
        const base = success > 0
          ? this.t("messages.uploadPartial", `${success} image${success > 1 ? 's' : ''} ok.`).replace("{count}", success)
          : this.t("messages.uploadNone", "Aucune image envoyée.");
        const msg = [base, errors.join(' | ')].join(' ');
        this.setUpload(msg, 'error');
      }
      return success > 0;
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
    startDrag(index, event) {
      this.dragIndex = index;
      this.dragOverIndex = index;
      if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      }
    },
    onDragOver(index, event) {
      if (event) event.preventDefault();
      if (this.dragIndex === null) return;
      this.dragOverIndex = index;
    },
    async onDrop(index, event) {
      if (event) event.preventDefault();
      let from = this.dragIndex;
      if (from === null && event?.dataTransfer) {
        const parsed = Number(event.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(parsed)) from = parsed;
      }
      if (from === null) return;
      const list = [...this.visible];
      const [moved] = list.splice(from, 1);
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
        await this.updateImageVisibility(name, true);
      }
      this.selectedVisible = [];
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async hideImage(name) {
      this.selectedVisible = this.selectedVisible.filter(n => n !== name);
      await this.updateImageVisibility(name, true);
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async showImage(name) {
      this.selectedHidden = this.selectedHidden.filter(n => n !== name);
      await this.updateImageVisibility(name, false);
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async deleteImage(name) {
      const impacted = await this.countImageUsage([name]);
      const msg = impacted > 0
        ? this.t("confirm.deleteOneUsed", "Supprimer définitivement cette image ? Elle est utilisée dans {count} scène{plural} et sera retirée.")
          .replace("{count}", impacted).replace("{plural}", impacted > 1 ? "s" : "")
        : this.t("confirm.deleteOne", "Supprimer définitivement cette image ? Elle sera retirée de toutes vos scènes.");
      this.askConfirm(msg, async () => {
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
        await this.updateImageVisibility(name, false);
      }
      this.selectedHidden = [];
      await this.refreshGallery();
      await this.fetchQuota();
    },
    async updateImageVisibility(name, hidden) {
      const safeName = encodeURIComponent(name);
      await fetch(`${this.API}/api/${this.tenantId}/images/${safeName}/hide`, {
        method: 'PUT',
        headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden })
      });
    },
    async deleteSelectedHidden() {
      if (!this.selectedHidden.length) return;
      const names = [...this.selectedHidden];
      const impacted = await this.countImageUsage(names);
      const msg = impacted > 0
        ? this.t("confirm.deleteManyUsed", `Supprimer définitivement ${names.length} image${names.length > 1 ? 's' : ''} ? Elles sont utilisées dans ${impacted} scène${impacted > 1 ? 's' : ''} et seront retirées.`)
          .replace("{count}", names.length)
          .replace("{plural}", names.length > 1 ? "s" : "")
          .replace("{impacted}", impacted)
          .replace("{pluralImp}", impacted > 1 ? "s" : "")
        : this.t("confirm.deleteMany", `Supprimer définitivement ${names.length} image${names.length > 1 ? 's' : ''} ? Elles seront retirées de toutes vos scènes.`)
          .replace("{count}", names.length)
          .replace("{plural}", names.length > 1 ? "s" : "");
      this.askConfirm(msg, async () => {
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

export function galleryPage() {
  const base = coreSection();
  const baseInit = base.init;
  const gallery = gallerySection();
  return {
    ...base,
    ...gallery,
    section: 'galerie',
    async init() {
      if (typeof baseInit === "function") {
        await baseInit.call(this);
      }
      await this.loadTexts();
      await this.refreshGallery();
    }
  };
}

window.galleryPage = galleryPage;
