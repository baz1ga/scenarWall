import { pixabayMixin } from '/admin/js/pixabay.js';
import { sanitizeFallback } from '/admin/js/i18n.js';

export function uploadModalMixin({ onFilesSelected } = {}) {
  const handleFiles = typeof onFilesSelected === 'function' ? onFilesSelected : null;

  return {
    ...pixabayMixin(),
    uploadModalOpen: false,
    uploadContext: 'gallery',
    uploadTab: 'drop',
    uploadDragActive: false,
    uploadUrl: '',
    uploadUrlMessage: '',
    uploadUrlStatus: 'ok',
    uploadUrlLoading: false,
    // Helpers
    ts(key, fallback = '') {
      const safe = sanitizeFallback(fallback);
      if (typeof this.t === 'function') return this.t(key, safe);
      if (key) return safe || key;
      return safe || '';
    },
    safeText(text) {
      return sanitizeFallback(text);
    },

    openUploadModal(context = 'gallery') {
      this.uploadContext = context || 'gallery';
      this.uploadModalOpen = true;
      this.uploadTab = 'drop';
      this.uploadDragActive = false;
      this.uploadUrl = '';
      this.uploadUrlMessage = '';
      this.uploadUrlStatus = 'ok';
      this.uploadUrlLoading = false;
      this.pixabayMessage = '';
      this.pixabayStatus = 'ok';
      this.pixabayLoading = false;
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
          this.pixabayMessage = typeof this.t === 'function'
            ? this.ts("upload.pixabayMissingKey", "Clé API Pixabay manquante (PIXABAY_KEY)")
            : '';
          this.pixabayStatus = 'error';
          return;
        }
        this.searchPixabay({ allowEmpty: true });
      }
    },
    async processSelectedFiles(files = []) {
      if (!files.length) return false;
      const context = (this.uploadContext || 'gallery').toLowerCase();
      const list = Array.isArray(files) ? files : [];
      const selected = context === 'avatar' ? list.slice(0, 1) : list;
      if (!handleFiles) {
        this.selectedUploadFile = selected[0];
        this.closeUploadModal();
        return true;
      }
      const result = await handleFiles.call(this, selected, this.uploadContext);
      if (result !== false) this.closeUploadModal();
      return result;
    },
    async handleUploadDrop(event) {
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files || []);
      this.uploadDragActive = false;
      if (!files.length) return;
      await this.processSelectedFiles(files);
    },
    async uploadFile(eventOrFiles) {
      const files = Array.isArray(eventOrFiles)
        ? Array.from(eventOrFiles)
        : Array.from(eventOrFiles?.target?.files || []);
      if (eventOrFiles?.target) eventOrFiles.target.value = '';
      if (!files.length) return;
      await this.processSelectedFiles(files);
    },
    async uploadFromUrl(urlOverride = '') {
      const targetUrl = urlOverride || this.uploadUrl;
      if (!targetUrl) return;
      this.uploadUrlLoading = true;
      this.uploadUrlMessage = '';
      this.uploadUrlStatus = 'ok';
      try {
        const res = await fetch(targetUrl, { mode: 'cors' }).catch(() => null);
        if (!res || !res.ok) throw new Error(this.t ? this.t("characters.upload.urlFetchError", "Impossible de récupérer l'image.") : 'Fetch failed');
        const blob = await res.blob();
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) throw new Error(this.t ? this.t("characters.upload.urlNotImage", "Le lien ne pointe pas vers une image.") : 'Not an image');
        const urlPath = targetUrl.split('/').pop() || 'image';
        const extFromType = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        const safeName = urlPath.match(/[^?#]+/)?.[0] || `upload.${extFromType}`;
        const baseName = safeName.includes('.') ? safeName.slice(0, 120) : safeName;
        const avatarName = `avatar_${Date.now()}.${extFromType || 'jpg'}`;
        const finalName = (this.uploadContext || '').toLowerCase() === 'avatar'
          ? avatarName
          : (baseName.includes('.') ? baseName : `${baseName}.${extFromType}`);
        const file = new File([blob], finalName, { type: contentType || 'image/jpeg' });
        const result = await this.processSelectedFiles([file]);
        if (result === false) {
          this.uploadUrlMessage = this.uploadUrlMessage || (this.t ? this.t("characters.upload.urlImportFail", "Import depuis URL impossible.") : 'URL import failed');
          this.uploadUrlStatus = 'error';
          this.uploadModalOpen = true;
        } else {
          this.uploadUrlMessage = this.t ? this.t("characters.upload.urlImported", "Image importée.") : 'Image importée.';
          this.uploadUrlStatus = 'ok';
          this.uploadUrl = '';
        }
      } catch (err) {
        this.uploadUrlMessage = err?.message || (this.t ? this.t("characters.upload.urlImportFail", "Import depuis URL impossible.") : 'URL import failed');
        this.uploadUrlStatus = 'error';
      }
      this.uploadUrlLoading = false;
    },
    async importFromPixabay(hitOrUrl) {
      const url = typeof hitOrUrl === 'string'
        ? hitOrUrl
        : (hitOrUrl?.largeImageURL || hitOrUrl?.webformatURL || hitOrUrl?.previewURL);
      if (!url) return;
      this.pixabayMessage = '';
      this.pixabayStatus = 'ok';
      await this.uploadFromUrl(url);
      if (this.uploadUrlStatus === 'ok') {
        this.pixabayMessage = this.t ? this.t("messages.pixabayImportOk", "Image importée depuis Pixabay.") : 'Image importée.';
        this.pixabayStatus = 'ok';
      } else {
        this.pixabayMessage = this.uploadUrlMessage || (this.t ? this.t("messages.pixabayImportFail", "Import Pixabay impossible.") : 'Import Pixabay impossible.');
        this.pixabayStatus = 'error';
      }
    }
  };
}
