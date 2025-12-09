import { coreSection } from '/admin/js/core.js';
import { pixabayMixin } from '/admin/js/pixabay.js';

export function sessionViewSection(baseInit) {
  return {
    loading: true,
    error: '',
    session: null,
    scenarioTitle: '',
    scenarioId: '',
    sessionTitle: '',
    scenarioLink: '/admin/scenarios/list.html',
    sessionLink: '',
    breadcrumbLabel: '',
    breadcrumb: 'Scénarios > Sessions > Scènes',
    scenes: [],
    currentScene: null,
    activeTab: 'images',
    dragIndex: null,
    savingOrder: false,
    showDeleteSessionModal: false,
    showDeleteSceneModal: false,
    pendingScene: null,
    sceneModal: {
      open: false,
      title: '',
      saving: false,
      error: ''
    },
    sceneEditModal: {
      open: false,
      title: '',
      saving: false,
      error: ''
    },
    sceneSelectionLoading: false,
    sceneSelectionTimer: null,
    zoomModal: {
      open: false,
      url: '',
      name: ''
    },
    // images tenant
    tenantImages: [],
    tenantDragIndex: null,
    tenantDragOver: null,
    galleryLoading: false,
    uploadMessage: '',
    uploadStatus: 'ok',
    uploadModalOpen: false,
    uploadTab: 'drop',
    uploadDragActive: false,
    uploadUrl: '',
    uploadUrlMessage: '',
    uploadUrlStatus: 'ok',
    uploadUrlLoading: false,
    ...pixabayMixin(),
    imageDragIndex: null,
    imageDragOver: null,
    editModal: {
      open: false,
      title: '',
      saving: false,
      error: ''
    },
    tabs: [
      { id: 'images', label: 'Images' },
      { id: 'audio', label: 'Audio' },
      { id: 'notes', label: 'Notes' },
      { id: 'tension', label: 'Tension' }
    ],

    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      this.section = 'scenarios';
      const params = new URLSearchParams(window.location.search || '');
      const sessionId = params.get('id');
      if (!sessionId) {
        this.error = 'Session introuvable';
        this.loading = false;
        return;
      }
      try {
        await this.fetchSession(sessionId);
        await this.fetchScenes(sessionId);
        await this.refreshTenantImages();
      } catch (err) {
        this.error = err?.message || 'Impossible de charger la session';
      } finally {
        this.loading = false;
      }
    },

    async deleteSessionConfirm() {
      if (!this.session?.id) return;
      this.showDeleteSessionModal = true;
    },

    async confirmDeleteSession() {
      if (!this.session?.id || !this.tenantId) return;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.session.id)}`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('Suppression impossible');
        this.showDeleteSessionModal = false;
        window.location.href = '/admin/scenarios/list.html';
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la suppression de la session';
      }
    },

    cancelDeleteSession() {
      this.showDeleteSessionModal = false;
    },

    async fetchSession(id) {
      if (!this.tenantId) return;
      const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(id)}`, {
        headers: this.headersAuth()
      });
      if (!res.ok) throw new Error('Session introuvable');
      const data = await res.json();
      this.session = data;
      this.sessionTitle = data.title || '';
      this.sessionLink = data.id ? `/admin/sessions/view.html?id=${encodeURIComponent(data.id)}` : '';
      this.scenarioId = data.parentScenario || '';
      this.scenarioLink = this.scenarioId ? `/admin/sessions/list.html?scenario=${encodeURIComponent(this.scenarioId)}` : '/admin/scenarios/list.html';
      this.breadcrumbLabel = data.parentScenario
        ? `Scénario ${data.parentScenario} • Session ${data.id}`
        : `Session ${data.id}`;
      this.updateBreadcrumb();
      if (data.parentScenario) {
        this.fetchScenarioTitle(data.parentScenario);
      }
    },

    async fetchScenarioTitle(id) {
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenarios/${encodeURIComponent(id)}`, {
          headers: this.headersAuth()
        });
        if (!res.ok) return;
        const scenario = await res.json();
        this.scenarioTitle = scenario.title || '';
        this.breadcrumbLabel = `${scenario.title || scenario.id} • Session ${this.session?.title || this.session?.id || ''}`;
        this.updateBreadcrumb();
      } catch (err) {
        // silent
      }
    },

    async fetchScenes(sessionId) {
      if (!this.tenantId) return;
      const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, {
        headers: this.headersAuth()
      });
      if (!res.ok) throw new Error('Impossible de charger les scènes');
      const list = (await res.json()).filter(scene => scene.parentSession === sessionId);
      list.sort((a, b) => {
        const orderDiff = (a.order || 0) - (b.order || 0);
        if (orderDiff !== 0) return orderDiff;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
      this.scenes = list.map(sc => ({ ...sc, images: this.normalizeImages(sc.images) }));
      this.currentScene = this.scenes.length ? this.scenes[this.scenes.length - 1] : null;
      this.updateBreadcrumb();
    },

    dragStart(index) {
      this.dragIndex = index;
    },
    dragOver(index) {
      if (index === this.dragIndex || this.dragIndex === null) return;
    },
    async dropScene(index) {
      // drag & drop désactivé (remplacé par navigation via flèches)
    },

    async saveSceneOrder() {
      if (!this.tenantId || !this.scenes.length) return;
      this.savingOrder = true;
      try {
        await this.saveSceneOrderFallback();
      } catch (err) {
        this.error = err?.message || 'Erreur lors du réordonnancement';
      } finally {
        this.savingOrder = false;
      }
    },

    async saveSceneOrderFallback() {
      // Fallback si l’endpoint /scenes/reorder n’est pas disponible
      for (const scene of this.scenes) {
        try {
          await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(scene.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
            body: JSON.stringify(scene)
          });
        } catch (e) {
          // on continue pour essayer les autres
        }
      }
    },

   setCurrentScene(id) {
      const found = this.scenes.find(s => s.id === id);
      if (!found) return;
      if (this.currentScene?.id === found.id && !this.sceneSelectionLoading) return;
      this.currentScene = found;
      this.activeTab = 'images';
      this.updateBreadcrumb();
      this.sceneSelectionLoading = true;
      if (this.sceneSelectionTimer) clearTimeout(this.sceneSelectionTimer);
      this.sceneSelectionTimer = setTimeout(() => {
        this.sceneSelectionLoading = false;
        this.sceneSelectionTimer = null;
      }, 1000);
    },

    openEditModal() {
      this.editModal = {
        open: true,
        title: this.sessionTitle || '',
        saving: false,
        error: ''
      };
    },

    closeEditModal() {
      this.editModal = { open: false, title: '', saving: false, error: '' };
    },

    async submitEdit() {
      const title = (this.editModal.title || '').trim();
      if (!title) {
        this.editModal.error = 'Le titre est requis';
        return;
      }
      if (!this.tenantId || !this.session?.id) {
        this.editModal.error = 'Session introuvable';
        return;
      }
      this.editModal.saving = true;
      this.editModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.session.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ title })
        });
        if (!res.ok) throw new Error('Mise à jour impossible');
        await this.fetchSession(this.session.id);
        this.closeEditModal();
      } catch (err) {
        this.editModal.error = err?.message || 'Erreur lors de la sauvegarde';
      } finally {
        this.editModal.saving = false;
      }
    },

    openSceneModal() {
      this.sceneModal = { open: true, title: '', saving: false, error: '' };
    },

    closeSceneModal() {
      this.sceneModal = { open: false, title: '', saving: false, error: '' };
    },

    async submitScene() {
      const title = (this.sceneModal.title || '').trim();
      if (!title) {
        this.sceneModal.error = 'Le titre est requis';
        return;
      }
      if (!this.tenantId || !this.session?.id) {
        this.sceneModal.error = 'Session introuvable';
        return;
      }
      this.sceneModal.saving = true;
      this.sceneModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({
            title,
            parentSession: this.session.id
          })
        });
        if (!res.ok) throw new Error('Création impossible');
        const created = await res.json();
        await this.fetchScenes(this.session.id);
        this.closeSceneModal();
        if (created?.id) {
          this.setCurrentScene(created.id);
        }
      } catch (err) {
        this.sceneModal.error = err?.message || 'Erreur lors de la création';
      } finally {
        this.sceneModal.saving = false;
      }
    },

    openSceneEditModal() {
      if (!this.currentScene) return;
      this.sceneEditModal = {
        open: true,
        title: this.currentScene.title || '',
        saving: false,
        error: ''
      };
    },

    closeSceneEditModal() {
      this.sceneEditModal = { open: false, title: '', saving: false, error: '' };
    },

    async submitSceneEdit() {
      const title = (this.sceneEditModal.title || '').trim();
      if (!title) {
        this.sceneEditModal.error = 'Le titre est requis';
        return;
      }
      if (!this.tenantId || !this.currentScene?.id) {
        this.sceneEditModal.error = 'Scène introuvable';
        return;
      }
      this.sceneEditModal.saving = true;
      this.sceneEditModal.error = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.currentScene.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ title })
        });
        if (!res.ok) throw new Error('Mise à jour impossible');
        await this.fetchScenes(this.session.id);
        const refreshed = this.scenes.find(s => s.id === this.currentScene.id);
        if (refreshed) this.setCurrentScene(refreshed.id);
        this.closeSceneEditModal();
      } catch (err) {
        this.sceneEditModal.error = err?.message || 'Erreur lors de la sauvegarde';
      } finally {
        this.sceneEditModal.saving = false;
      }
    },

    startImageDrag(idx) {
      this.imageDragIndex = idx;
    },
    overImageDrag(idx) {
      this.imageDragOver = idx;
    },
    async dropImage(idx) {
      if (this.imageDragIndex === null || idx === this.imageDragIndex) {
        this.imageDragIndex = null;
        this.imageDragOver = null;
        return;
      }
      const imgs = this.normalizeImages(this.currentScene?.images);
      if (!imgs.length) {
        this.imageDragIndex = null;
        this.imageDragOver = null;
        return;
      }
      const arr = [...imgs];
      const [item] = arr.splice(this.imageDragIndex, 1);
      arr.splice(idx, 0, item);
      const reordered = arr.map((img, i) => ({ ...img, order: i + 1 }));
      this.currentScene = { ...this.currentScene, images: reordered };
      await this.updateSceneImages(reordered);
      this.imageDragIndex = null;
      this.imageDragOver = null;
    },

    handleTenantDragStart(index) {
      this.tenantDragIndex = index;
    },
    handleTenantDragOver(index) {
      this.tenantDragOver = index;
    },
    moveScene(index, dir) {
      const target = index + dir;
      if (target < 0 || target >= this.scenes.length) return;
      const arr = [...this.scenes];
      const [item] = arr.splice(index, 1);
      arr.splice(target, 0, item);
      this.scenes = arr.map((scene, i) => ({ ...scene, order: i + 1 }));
      this.setCurrentScene(item.id);
      this.saveSceneOrder();
    },
    handleTenantDrop(index) {
      if (this.tenantDragIndex === null) return;
      const img = this.tenantImages[this.tenantDragIndex];
      if (img?.name) {
        this.addImageToScene(img.name);
      }
      this.tenantDragIndex = null;
      this.tenantDragOver = null;
    },
    addImageToScene(name, persist = true) {
      if (!name || !this.currentScene) return;
      const imgs = this.normalizeImages(this.currentScene.images);
      const nextOrder = imgs.length + 1;
      imgs.push({ name, order: nextOrder });
      this.currentScene = { ...this.currentScene, images: imgs };
      if (persist && this.currentScene.id) this.updateSceneImages(imgs);
    },

    async updateSceneImages(images) {
      if (!this.tenantId || !this.currentScene?.id) return;
      try {
        await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.currentScene.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ ...this.currentScene, images })
        });
        await this.fetchScenes(this.session?.id);
        if (this.currentScene?.id) this.setCurrentScene(this.currentScene.id);
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la mise à jour des images';
      }
    },

    async removeImageFromScene(index) {
      if (index === undefined || index === null || !this.currentScene) return;
      const imgs = this.normalizeImages(this.currentScene.images);
      if (index < 0 || index >= imgs.length) return;
      imgs.splice(index, 1);
      const reordered = imgs.map((img, idx) => ({ ...img, order: idx + 1 }));
      this.currentScene = { ...this.currentScene, images: reordered };
      await this.updateSceneImages(reordered);
    },
    async duplicateScene(scene) {
      if (!scene || !this.session?.id || !this.tenantId) return;
      try {
        const titleBase = scene.title || 'Scène';
        const payload = {
          title: `${titleBase} (copie)`,
          parentSession: this.session.id,
          images: this.normalizeImages(scene.images),
          audio: Array.isArray(scene.audio) ? [...scene.audio] : [],
          tension: scene.tension || null,
          notes: scene.notes || null
        };
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Duplication impossible');
        const created = await res.json();
        await this.fetchScenes(this.session.id);
        if (created?.id) this.setCurrentScene(created.id);
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la duplication';
      }
    },

    openZoom(name) {
      const img = this.tenantImageFor(name);
      const url = img?.url || img?.thumbUrl;
      if (url) {
        this.zoomModal = { open: true, url, name: name || '' };
      }
    },
    closeZoom() {
      this.zoomModal = { open: false, url: '', name: '' };
    },

    async refreshTenantImages() {
      if (!this.tenantId) return;
      this.galleryLoading = true;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/images`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error('Images');
        const data = await res.json();
        this.tenantImages = Array.isArray(data) ? data.filter(i => !i.hidden) : [];
      } catch (e) {
        this.tenantImages = [];
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
          this.pixabayMessage = 'Clé API Pixabay manquante.';
          this.pixabayStatus = 'error';
          return;
        }
        this.searchPixabay({ allowEmpty: true });
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
      const uploadedNames = [];
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
            errors.push(data.error || `Échec pour ${file.name}`);
          } else {
            success++;
            uploadedNames.push(file.name);
          }
        } catch (err) {
          errors.push(`Réseau: ${file.name}`);
        }
      }
      if (success > 0) {
        await this.refreshTenantImages();
        await this.fetchQuota?.();
        this.closeUploadModal();
        if (this.currentScene) {
          uploadedNames.forEach(name => this.addImageToScene(name));
        }
      } else {
        await this.fetchQuota?.();
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
      return uploadedNames;
    },
    async uploadFromUrl(urlOverride = '') {
      const targetUrl = urlOverride || this.uploadUrl;
      if (!targetUrl || !this.tenantId) return;
      this.uploadUrlLoading = true;
      this.uploadUrlMessage = '';
      this.uploadUrlStatus = 'ok';
      try {
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error('URL invalide');
        const blob = await res.blob();
        const file = new File([blob], `import_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
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
    setUpload(msg, status = 'ok') {
      this.uploadMessage = msg;
      this.uploadStatus = status;
    },
    tenantImageFor(name) {
      if (!name) return null;
      return this.tenantImages.find(img => img.name === name) || null;
    },

    // zoom from tenant library
    openZoomFromTenant(name) {
      const img = this.tenantImageFor(name);
      const url = img?.url || img?.thumbUrl;
      if (url) this.zoomModal = { open: true, url, name: name || '' };
    },

    normalizeImages(arr) {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((item, idx) => {
          if (typeof item === 'string') return { name: item, order: idx + 1 };
          const name = typeof item?.name === 'string' ? item.name : '';
          if (!name) return null;
          const order = typeof item?.order === 'number' ? item.order : idx + 1;
          return { name, order };
        })
        .filter(Boolean)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    },


    deleteScene(scene) {
      if (!scene || !scene.id || !this.tenantId) return;
      this.pendingScene = scene;
      this.showDeleteSceneModal = true;
    },

    async confirmDeleteSceneOnly() {
      if (!this.pendingScene?.id || !this.tenantId) {
        this.showDeleteSceneModal = false;
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.pendingScene.id)}`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('Suppression impossible');
        await this.fetchScenes(this.session?.id);
        this.showDeleteSceneModal = false;
        this.pendingScene = null;
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la suppression de la scène';
      } finally {
        this.showDeleteSceneModal = false;
        this.pendingScene = null;
      }
    },

    cancelDeleteScene() {
      this.showDeleteSceneModal = false;
      this.pendingScene = null;
    },

    async confirmDeleteSceneAndSession() {
      if (!this.pendingScene?.id || !this.tenantId || !this.session?.id) {
        this.showDeleteSceneModal = false;
        return;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.pendingScene.id)}`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('Suppression impossible');
        const sessRes = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.session.id)}`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        if (!sessRes.ok) throw new Error('Suppression de la session impossible');
        this.showDeleteSceneModal = false;
        this.pendingScene = null;
        window.location.href = '/admin/scenarios/list.html';
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la suppression';
      } finally {
        this.showDeleteSceneModal = false;
        this.pendingScene = null;
      }
    },

    formatDate(ts) {
      if (!ts) return '';
      const val = Number(ts);
      const date = new Date((String(val).length === 13 ? val : val * 1000));
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    },

    updateBreadcrumb() {
      const scenarioPart = this.scenarioTitle || this.session?.parentScenario || 'Scénario';
      const sessionPart = this.session?.title || this.session?.id || 'Session';
      const scenePart = this.currentScene?.title || this.currentScene?.id || 'Scène';
      this.breadcrumb = `Scénarios > ${scenarioPart} > ${sessionPart} > ${scenePart}`;
    }
  };
}

export function sessionViewPage() {
  const base = coreSection();
  const baseInit = base.init;
  return {
    ...base,
    ...sessionViewSection(baseInit)
  };
}

window.sessionViewPage = sessionViewPage;
