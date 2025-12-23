import { coreSection } from '/admin/js/core.js';
import { uploadModalMixin } from '/admin/js/upload-modal.js';
import { DEFAULT_SESSION_ICON, ICON_OPTIONS, filterIcons } from '/admin/js/icon-picker-utils.js';
import { loadLocale, t as translate } from '/admin/js/i18n.js';
// SimpleMDE supprimé : éditeur basculé en textarea simple

export function sessionViewSection(baseInit) {
  return {
    ...uploadModalMixin({
      async onFilesSelected(files, context) {
        return this.handleUploadSelection(files, context);
      }
    }),
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
    selectedSceneId: '',
    pendingSceneId: '',
    charactersLoading: false,
    characters: [],
    availableCharactersLoading: false,
    availableCharacters: [],
    characterRole: 'npc',
    characterModal: {
      open: false,
      editing: false,
      error: '',
      avatarFile: null,
      avatarFileName: '',
      form: {
        id: '',
        name: '',
        role: '',
        type: '',
        race: '',
        history: '',
        hpCurrent: 0,
        hpMax: 0,
        sessions: [],
        parentScenario: ''
      }
    },
    importModal: {
      open: false,
      error: ''
    },
    // Tension (session-level)
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
    defaultTensionFont: 'Audiowide',
    defaultTensionAudio: {
      level1: null,
      level2: null,
      level3: null,
      level4: null,
      level5: null
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
    tensionSaving: false,
    tensionSaveTimer: null,
    sessionSceneStorageKey() {
      return this.session?.id ? `sw_session_current_scene_${this.session.id}` : null;
    },
    storeSelectedScene(id) {
      const key = this.sessionSceneStorageKey();
      if (!key || !id) return;
      try { localStorage.setItem(key, id); } catch (_) {}
    },
    readStoredScene() {
      const key = this.sessionSceneStorageKey();
      if (!key) return '';
      try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
    },
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
    // audio tenant
    tenantAudio: [],
    tenantAudioLoading: false,
    tenantAudioDragIndex: null,
    tenantAudioDragOver: null,
    sceneAudioDragIndex: null,
    sceneAudioDragOver: null,
    audioUploadStatus: 'ok',
    audioUploadMessage: '',
    audioUploading: false,
    notesSaving: false,
    notesLoading: false,
    noteName: '',
    noteContentBuffer: '',
    noteSaveTimer: null,
    noteSaveDisabled: false,
    noteInputBound: false,
    async noteNextTick() {
      return new Promise(resolve => setTimeout(resolve, 0));
    },
    async waitForNotesTextarea(retries = 20, delay = 50) {
      console.debug('[Notes] waitForTextarea start', { retries, delay });
      for (let i = 0; i < retries; i++) {
        const refEl = this.$refs?.sceneNotesArea;
        if (refEl) return refEl;
        const domEl = document.querySelector('[x-ref=\"sceneNotesArea\"]');
        if (domEl) return domEl;
        await new Promise(res => setTimeout(res, delay));
      }
      console.warn('[Notes] textarea not found');
      return null;
    },
    getNotesTextarea() {
      return this.$refs?.sceneNotesArea || document.querySelector('[x-ref=\"sceneNotesArea\"]');
    },
    setNotesValue(val) {
      const el = this.getNotesTextarea();
      if (el) el.value = val ?? '';
    },
    getNotesValue() {
      const el = this.getNotesTextarea();
      return el ? el.value : '';
    },
    uploadMessage: '',
    uploadStatus: 'ok',
    imageDragIndex: null,
    imageDragOver: null,
    defaultSessionIcon: DEFAULT_SESSION_ICON,
    iconOptions: ICON_OPTIONS,
    editModal: {
      open: false,
      title: '',
      icon: DEFAULT_SESSION_ICON,
      iconSearch: '',
      saving: false,
      error: ''
    },
    initialSceneParam: '',
    tabs: [
      { id: 'images', labelKey: 'tabs.images', fallback: 'Images' },
      { id: 'audio', labelKey: 'tabs.audio', fallback: 'Audio' },
      { id: 'notes', labelKey: 'tabs.notes', fallback: 'Notes' }
    ],
    showTension: false,
    lang: localStorage.getItem('lang') || (navigator.language || 'fr').slice(0, 2) || 'fr',
    texts: {},
    iconTexts: {},
    async loadDefaultTension() {
      try {
        const res = await fetch(`${this.API}/api/tension-default`, { headers: this.headersAuth() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Defaults');
        this.defaultTensionColors = this.normalizeTensionColors(data.tensionColors || {});
        this.defaultTensionLabels = this.normalizeTensionLabels(data.tensionLabels || {});
        this.defaultTensionFont = data.tensionFont || this.defaultTensionFont;
        this.defaultTensionAudio = this.normalizeTensionAudio(data.tensionAudio);
        this.tensionColors = { ...this.defaultTensionColors };
        this.tensionLabels = { ...this.defaultTensionLabels };
        this.tensionFont = this.defaultTensionFont;
        this.tensionAudio = { ...this.defaultTensionAudio };
        this.tensionEnabled = data.tensionEnabled !== undefined ? !!data.tensionEnabled : this.tensionEnabled;
      } catch (err) {
        console.warn('[Tension] default load failed', err?.message);
      }
    },

    async init() {
      if (typeof baseInit === 'function') {
        await baseInit.call(this);
      }
      // harmonise la langue avec la config/LS avant de charger les textes
      this.lang = (localStorage.getItem('lang') || (navigator.language || 'fr').slice(0, 2) || 'fr').toLowerCase();
      this.texts = await loadLocale(this.lang, 'sessions-scenes');
      this.iconTexts = await loadLocale(this.lang, 'icons');
      this.tabs = this.tabs.map(tab => ({
        ...tab,
        label: this.t(tab.labelKey, tab.fallback)
      }));
      this.section = 'scenarios';
      const params = new URLSearchParams(window.location.search || '');
      const sessionId = params.get('id');
      this.initialSceneParam = params.get('scene') || '';
      this.characterRole = this.detectCharacterRole();
      if (!sessionId) {
        this.error = this.t('errors.sessionNotFound', 'Session introuvable');
        this.loading = false;
        return;
      }
      try {
        await this.loadDefaultTension();
        await this.fetchSession(sessionId);
        await this.fetchScenes(sessionId);
        await this.loadCharacters();
        await this.refreshTenantImages();
        await this.refreshTenantAudio();
        this.showTension = false;
      } catch (err) {
        this.error = err?.message || this.t('errors.sessionLoad', 'Impossible de charger la session');
      } finally {
        this.loading = false;
      }
    },

    t(key, fallback = '') {
      return translate(this.texts, key, fallback);
    },

    filteredIcons(query = '') {
      return filterIcons(query, this.iconOptions, this.iconTexts);
    },
    detectCharacterRole() {
      const path = (window.location.pathname || '').toLowerCase();
      if (path.includes('edit-table')) return 'pc';
      return 'npc';
    },
    characterHeading() {
      return this.characterRole === 'pc'
        ? this.t('characters.playersTitle', 'Personnages joueurs')
        : this.t('characters.npcTitle', 'Personnages non-joueurs');
    },
    characterRoleLabel() {
      return this.characterRole === 'pc'
        ? this.t('characters.role.pc', 'PJ')
        : this.t('characters.role.npc', 'PNJ');
    },
    avatarUrl(ch) {
      if (!ch?.avatar || !this.tenantId) return '';
      return `${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(ch.id)}/avatar`;
    },
    avatarThumbUrl(ch) {
      if (!ch?.avatar || !this.tenantId) return '';
      return `${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(ch.id)}/avatar-thumb`;
    },
    async loadCharacters() {
      if (!this.tenantId || !this.session?.id) return;
      this.charactersLoading = true;
      try {
        const role = encodeURIComponent(this.characterRole || '');
        const sessionId = encodeURIComponent(this.session.id);
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/characters?role=${role}&session=${sessionId}`, {
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('characters');
        this.characters = await res.json();
      } catch (err) {
        this.characters = [];
      }
      this.charactersLoading = false;
    },
    async loadAvailableCharacters() {
      if (!this.tenantId || !this.session?.id) return;
      this.availableCharactersLoading = true;
      try {
        const role = encodeURIComponent(this.characterRole || '');
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/characters?role=${role}`, {
          headers: this.headersAuth()
        });
        const list = res.ok ? await res.json() : [];
        const currentSessionId = this.session.id;
        const currentScenarioId = this.scenarioId;
        this.availableCharacters = (list || []).filter(ch => {
          const inSession = Array.isArray(ch.sessions) && ch.sessions.includes(currentSessionId);
          const sameScenario = currentScenarioId ? (ch.parentScenario === currentScenarioId) : false;
          return !inSession && !sameScenario;
        });
      } catch (err) {
        this.availableCharacters = [];
      }
      this.availableCharactersLoading = false;
    },
    openCharacterModal(ch = null) {
      const base = {
        id: '',
        name: '',
        role: this.characterRole,
        type: '',
        race: '',
        history: '',
        hpCurrent: 0,
        hpMax: 0,
        sessions: this.session?.id ? [this.session.id] : [],
        parentScenario: this.scenarioId || ''
      };
      this.characterModal = {
        open: true,
        editing: !!ch,
        error: '',
        avatarFile: null,
        avatarFileName: '',
        form: ch ? { ...base, ...ch, role: ch.role || this.characterRole } : base
      };
    },
    closeCharacterModal() {
      this.characterModal = {
        open: false,
        editing: false,
        error: '',
        avatarFile: null,
        avatarFileName: '',
        form: {
          id: '',
          name: '',
          role: this.characterRole,
          type: '',
          race: '',
          history: '',
          hpCurrent: 0,
          hpMax: 0,
          sessions: this.session?.id ? [this.session.id] : [],
        parentScenario: this.scenarioId || ''
        }
      };
    },
    openImportModal() {
      this.importModal = { open: true, error: '' };
      this.loadAvailableCharacters();
    },
    closeImportModal() {
      this.importModal = { open: false, error: '' };
    },
    openAvatarUpload() {
      this.importModal = { open: false, error: '' };
      this.openUploadModal('avatar');
    },
    async saveCharacter() {
      if (!this.tenantId || !this.session?.id) return;
      const form = { ...this.characterModal.form };
      form.role = (form.role || this.characterRole || '').toLowerCase();
      if (!form.name.trim()) {
        this.characterModal.error = this.t('characters.errors.name', 'Nom requis');
        return;
      }
      form.sessions = Array.isArray(form.sessions) && form.sessions.length ? form.sessions : [this.session.id];
      if (!form.parentScenario && this.scenarioId) form.parentScenario = this.scenarioId;
      const payload = {
        ...form,
        hpCurrent: Number.isFinite(form.hpCurrent) ? form.hpCurrent : 0,
        hpMax: Number.isFinite(form.hpMax) ? form.hpMax : 0
      };
      if (!this.characterModal.editing) {
        payload.hpCurrent = payload.hpMax;
      }
      const editing = this.characterModal.editing && form.id;
      const url = editing
        ? `${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(form.id)}`
        : `${this.API}/api/tenant/${this.tenantId}/characters`;
      const method = editing ? 'PUT' : 'POST';
      try {
        const res = await fetch(url, {
          method,
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'save');
        let saved = data;
        if (this.characterModal.avatarFile instanceof File) {
          try {
            saved = await this.uploadCharacterAvatar(saved.id, this.characterModal.avatarFile);
          } catch (err) {
            this.characterModal.error = err?.message || this.t('characters.errors.save', 'Sauvegarde impossible');
            return;
          }
        }
        this.closeCharacterModal();
        await this.loadCharacters();
      } catch (err) {
        this.characterModal.error = err?.message || this.t('characters.errors.save', 'Sauvegarde impossible');
      }
    },
    async uploadCharacterAvatar(id, file) {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(id)}/avatar`, {
        method: 'POST',
        headers: this.headersAuth(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'upload');
      return data;
    },
    async importCharacter(ch) {
      if (!ch?.id || !this.tenantId || !this.session?.id) return;
      const sessions = Array.isArray(ch.sessions) ? Array.from(new Set([...ch.sessions, this.session.id])) : [this.session.id];
      const payload = { ...ch, sessions };
      if (!payload.parentScenario && this.scenarioId) payload.parentScenario = this.scenarioId;
      return payload;
    },
    async useCharacter(ch) {
      try {
        const payload = await this.importCharacter(ch);
        if (!payload) return;
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(ch.id)}`, {
          method: 'PUT',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'import');
        await this.loadCharacters();
        this.closeImportModal();
      } catch (err) {
        this.importModal.error = err?.message || this.t('characters.errors.save', 'Sauvegarde impossible');
      }
    },
    async duplicateCharacter(ch) {
      try {
        const payload = await this.importCharacter(ch);
        if (!payload) return;
        const clone = { ...payload };
        delete clone.id;
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/characters`, {
          method: 'POST',
          headers: { ...this.headersAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify(clone)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'duplicate');
        await this.loadCharacters();
        this.closeImportModal();
      } catch (err) {
        this.importModal.error = err?.message || this.t('characters.errors.save', 'Sauvegarde impossible');
      }
    },
    async deleteCharacter(id) {
      if (!this.tenantId || !id) return;
      const ok = window.confirm(this.t('characters.confirmDelete', 'Supprimer ce personnage ?'));
      if (!ok) return;
      try {
        await fetch(`${this.API}/api/tenant/${this.tenantId}/characters/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        await this.loadCharacters();
      } catch (err) {
        // silent
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
        if (!res.ok) throw new Error(this.t('errors.deleteSession', 'Suppression impossible'));
        this.showDeleteSessionModal = false;
        window.location.href = '/admin/scenarios/list.html';
      } catch (err) {
        this.error = err?.message || this.t('errors.deleteSessionGeneric', 'Erreur lors de la suppression de la session');
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
      if (!res.ok) throw new Error(this.t('errors.sessionNotFound', 'Session introuvable'));
      const data = await res.json();
      this.session = data;
      this.sessionTitle = data.title || '';
      // préremplir le formulaire d'édition quand la session arrive
      if (!this.editModal.title) this.editModal.title = this.sessionTitle;
      this.editModal.icon = data.icon || this.defaultSessionIcon;
      this.sessionLink = data.id ? `/admin/sessions/view.html?id=${encodeURIComponent(data.id)}` : '';
      this.scenarioId = data.parentScenario || '';
      this.scenarioLink = this.scenarioId ? `/admin/sessions/list.html?scenario=${encodeURIComponent(this.scenarioId)}` : '/admin/scenarios/list.html';
      this.breadcrumbLabel = data.parentScenario
        ? `${this.t('breadcrumb.scenario', 'Scénario')} ${data.parentScenario} • ${this.t('breadcrumb.session', 'Session')} ${data.id}`
        : `${this.t('breadcrumb.session', 'Session')} ${data.id}`;
      this.updateBreadcrumb();
      this.loadTensionFromSession(data);
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
      this.breadcrumbLabel = `${scenario.title || scenario.id} • ${this.t('breadcrumb.session', 'Session')} ${this.session?.title || this.session?.id || ''}`;
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
      if (!res.ok) throw new Error(this.t('errors.sceneLoad', 'Impossible de charger les scènes'));
      const list = (await res.json()).filter(scene => scene.parentSession === sessionId);
      list.sort((a, b) => {
        const orderDiff = (a.order || 0) - (b.order || 0);
        if (orderDiff !== 0) return orderDiff;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
      this.scenes = list.map(sc => ({
        ...sc,
        images: this.normalizeImages(sc.images),
        audio: this.normalizeAudio(sc.audio)
      }));
      const fromParam = this.initialSceneParam && this.scenes.find(s => s.id === this.initialSceneParam) ? this.initialSceneParam : '';
      const stored = this.readStoredScene();
      const target = fromParam || (stored && this.scenes.find(s => s.id === stored)?.id) || (this.scenes.length ? this.scenes[this.scenes.length - 1]?.id : '');
      if (target) {
        this.setCurrentScene(target, false);
      }
      this.initialSceneParam = '';
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
        this.error = err?.message || this.t('errors.reorder', 'Erreur lors du réordonnancement');
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

    applySceneSelection(id) {
      const found = this.scenes.find(s => s.id === id);
      if (!found) return;
      this.currentScene = found;
      this.selectedSceneId = found.id;
      this.activeTab = 'images';
      this.noteName = '';
      this.noteContentBuffer = '';
      this.noteSaveDisabled = false;
      this.noteInputBound = false;
      this.setNotesValue('');
      this.updateBreadcrumb();
      this.storeSelectedScene(found.id);
    },

    setCurrentScene(id, withLoader = false) {
      if (this.sceneSelectionTimer) {
        clearTimeout(this.sceneSelectionTimer);
        this.sceneSelectionTimer = null;
      }
      if (withLoader) {
        this.pendingSceneId = id;
        this.sceneSelectionLoading = true;
        this.sceneSelectionTimer = setTimeout(() => {
          this.sceneSelectionLoading = false;
          this.sceneSelectionTimer = null;
          const target = this.pendingSceneId || id;
          this.pendingSceneId = '';
          this.applySceneSelection(target);
        }, 900);
        return;
      }
      this.sceneSelectionLoading = false;
      this.pendingSceneId = '';
      this.applySceneSelection(id);
      if (this.activeTab === 'notes') {
        this.loadSceneNotesContent();
      }
    },

    openEditModal() {
      this.editModal = {
        open: true,
        title: this.sessionTitle || '',
        icon: (this.session?.icon) || this.defaultSessionIcon,
        iconSearch: '',
        saving: false,
        error: ''
      };
    },

    closeEditModal() {
      this.editModal = {
        open: false,
        title: '',
        icon: this.defaultSessionIcon,
        iconSearch: '',
        saving: false,
        error: ''
      };
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
          body: JSON.stringify({
            title,
            icon: this.editModal.icon || this.defaultSessionIcon
          })
        });
        if (!res.ok) throw new Error('Mise à jour impossible');
        await this.fetchSession(this.session.id);
        this.closeEditModal();
        try {
          window.location.reload();
        } catch (e) {}
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
        this.sceneModal.error = this.t('errors.titleRequired', 'Le titre est requis');
        return;
      }
      if (!this.tenantId || !this.session?.id) {
        this.sceneModal.error = this.t('errors.sessionNotFound', 'Session introuvable');
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
        if (!res.ok) throw new Error(this.t('errors.createScene', 'Création impossible'));
        const created = await res.json();
        await this.fetchScenes(this.session.id);
        this.closeSceneModal();
        if (created?.id) this.setCurrentScene(created.id, true);
      } catch (err) {
        this.sceneModal.error = err?.message || this.t('errors.createSceneGeneric', 'Erreur lors de la création');
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

    async setActiveTab(tab) {
      this.activeTab = tab;
      if (tab !== 'notes') return;
      console.debug('[Notes] tab opened', { sceneId: this.currentScene?.id, note: this.currentScene?.notes });
      this.noteSaveDisabled = true;
      this.noteName = this.currentScene?.notes || '';
      this.noteContentBuffer = '';
      try {
        if (!this.currentScene?.notes) {
          this.setNotesValue('');
          return;
        }
        console.debug('[Notes] loading note file');
        await this.loadSceneNoteFile();
        this.setNotesValue(this.noteContentBuffer || '');
        if (!this.noteInputBound) {
          const el = await this.waitForNotesTextarea();
          if (el) {
            el.addEventListener('input', () => this.queueSaveSceneNotes());
            this.noteInputBound = true;
          }
        }
      } catch (e) {
        // ignore load/init errors
      } finally {
        this.noteSaveDisabled = false;
      }
    },

    async submitSceneEdit() {
      const title = (this.sceneEditModal.title || '').trim();
      if (!title) {
        this.sceneEditModal.error = this.t('errors.titleRequired', 'Le titre est requis');
        return;
      }
      if (!this.tenantId || !this.currentScene?.id) {
        this.sceneEditModal.error = this.t('errors.sceneNotFound', 'Scène introuvable');
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
        if (!res.ok) throw new Error(this.t('errors.update', 'Mise à jour impossible'));
        await this.fetchScenes(this.session.id);
        const refreshed = this.scenes.find(s => s.id === this.currentScene.id);
        if (refreshed) this.setCurrentScene(refreshed.id, false);
        this.closeSceneEditModal();
      } catch (err) {
        this.sceneEditModal.error = err?.message || this.t('errors.save', 'Erreur lors de la sauvegarde');
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
      this.setCurrentScene(item.id, false);
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
      const sceneId = this.selectedSceneId || this.currentScene?.id;
      if (!name || !sceneId) return;
      const scene = this.scenes.find(s => s.id === sceneId) || this.currentScene;
      if (!scene) return;
      const imgs = this.normalizeImages(scene.images);
      const nextOrder = imgs.length + 1;
      imgs.push({ name, order: nextOrder });
      this.currentScene = { ...scene, images: imgs };
      this.selectedSceneId = sceneId;
      if (persist) this.updateSceneImages(imgs, sceneId);
    },

    async updateSceneImages(images, sceneIdOverride = '') {
      const sceneId = sceneIdOverride || this.selectedSceneId || this.currentScene?.id;
      if (!this.tenantId || !sceneId) return;
      try {
        await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(sceneId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ ...this.currentScene, id: sceneId, images })
        });
        await this.fetchScenes(this.session?.id);
        this.setCurrentScene(sceneId, false);
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la mise à jour des images';
      }
    },

    async removeImageFromScene(index) {
      const sceneId = this.selectedSceneId || this.currentScene?.id;
      if (index === undefined || index === null || !sceneId) return;
      const scene = this.scenes.find(s => s.id === sceneId) || this.currentScene;
      const imgs = this.normalizeImages(scene?.images);
      if (index < 0 || index >= imgs.length) return;
      imgs.splice(index, 1);
      const reordered = imgs.map((img, idx) => ({ ...img, order: idx + 1 }));
      this.currentScene = { ...scene, images: reordered };
      this.selectedSceneId = sceneId;
      await this.updateSceneImages(reordered, sceneId);
    },
    async duplicateScene(scene) {
      if (!scene || !this.session?.id || !this.tenantId) return;
      try {
        const titleBase = scene.title || 'Scène';
        const payload = {
          title: `${titleBase} (copie)`,
          parentSession: this.session.id,
          images: this.normalizeImages(scene.images),
          audio: this.normalizeAudio(scene.audio),
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
        if (created?.id) this.setCurrentScene(created.id, false);
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
        if (!res.ok) throw new Error(this.t('errors.images', 'Images'));
        const data = await res.json();
        this.tenantImages = Array.isArray(data) ? data : [];
      } catch (e) {
        this.tenantImages = [];
      }
      this.galleryLoading = false;
    },
    visibleTenantImages() {
      return Array.isArray(this.tenantImages) ? this.tenantImages.filter(i => !i.hidden) : [];
    },
    async handleUploadSelection(files, context = 'gallery') {
      const mode = (context || this.uploadContext || 'gallery').toLowerCase();
      const list = Array.isArray(files) ? files : [];
      if (mode === 'avatar') {
        const file = list[0];
        if (!file) return false;
        this.characterModal.avatarFile = file;
        this.characterModal.avatarFileName = file.name || '';
        return true;
      }
      return this.uploadImagesToTenant(list);
    },
    async uploadImagesToTenant(files = []) {
      if (!files.length || !this.tenantId) return false;
      let success = 0;
      const errors = [];
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
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            errors.push(data.error || `Échec pour ${file.name}`);
          } else {
            success++;
            const storedName = data.name || file.name;
            uploadedNames.push(storedName);
          }
        } catch (err) {
          errors.push(`Réseau: ${file.name}`);
        }
      }
      if (success > 0) {
        await this.refreshTenantImages();
        await this.fetchQuota?.();
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
      return success > 0;
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
    // audio - scene side
    startSceneAudioDrag(idx) {
      this.sceneAudioDragIndex = idx;
      this.sceneAudioDragOver = idx;
    },
    overSceneAudioDrag(idx) {
      this.sceneAudioDragOver = idx;
    },
    endSceneAudioDrag() {
      this.sceneAudioDragIndex = null;
      this.sceneAudioDragOver = null;
    },
    async dropSceneAudio(idx) {
      if (this.sceneAudioDragIndex === null || idx === this.sceneAudioDragIndex) {
        this.sceneAudioDragIndex = null;
        this.sceneAudioDragOver = null;
        return;
      }
      const items = this.normalizeAudio(this.currentScene?.audio);
      if (!items.length) {
        this.sceneAudioDragIndex = null;
        this.sceneAudioDragOver = null;
        return;
      }
      const arr = [...items];
      const [item] = arr.splice(this.sceneAudioDragIndex, 1);
      arr.splice(idx, 0, item);
      const reordered = arr.map((audio, i) => ({ ...audio, order: i + 1 }));
      this.currentScene = { ...this.currentScene, audio: reordered };
      await this.updateSceneAudio(reordered);
      this.sceneAudioDragIndex = null;
      this.sceneAudioDragOver = null;
    },
    async removeAudioFromScene(index) {
      const sceneId = this.selectedSceneId || this.currentScene?.id;
      if (index === undefined || index === null || !sceneId) return;
      const scene = this.scenes.find(s => s.id === sceneId) || this.currentScene;
      const list = this.normalizeAudio(scene?.audio);
      if (index < 0 || index >= list.length) return;
      list.splice(index, 1);
      const reordered = list.map((item, i) => ({ ...item, order: i + 1 }));
      this.currentScene = { ...scene, audio: reordered };
      this.selectedSceneId = sceneId;
      this.activeTab = 'audio';
      await this.updateSceneAudio(reordered, sceneId);
    },
    addAudioToScene(name, persist = true) {
      const sceneId = this.selectedSceneId || this.currentScene?.id;
      if (!name || !sceneId) return;
      const scene = this.scenes.find(s => s.id === sceneId) || this.currentScene;
      if (!scene) return;
      const list = this.normalizeAudio(scene.audio);
      const nextOrder = list.length + 1;
      list.push({ name, order: nextOrder });
      this.currentScene = { ...scene, audio: list };
      this.selectedSceneId = sceneId;
      this.activeTab = 'audio';
      if (persist) this.updateSceneAudio(list, sceneId);
    },
    async updateSceneAudio(audioList, sceneIdOverride = '') {
      const sceneId = sceneIdOverride || this.selectedSceneId || this.currentScene?.id;
      if (!this.tenantId || !sceneId) return;
      const normalized = this.normalizeAudio(audioList);
      try {
        await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(sceneId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ ...this.currentScene, id: sceneId, audio: normalized })
        });
        await this.fetchScenes(this.session?.id);
        this.setCurrentScene(sceneId, false);
        this.activeTab = 'audio';
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la mise à jour de l\'audio';
      }
    },
    async uploadSceneAudio(event) {
      const files = Array.from(event?.target?.files || []);
      if (event?.target) event.target.value = '';
      if (!files.length || !this.tenantId) return;
      let success = 0;
      const errors = [];
      const uploaded = [];
      this.audioUploading = true;
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
            uploaded.push(data.name || file.name);
          }
        } catch (err) {
          errors.push(`Réseau: ${file.name}`);
        }
      }
      if (success > 0) {
        await this.refreshTenantAudio();
        await this.fetchQuota?.();
        uploaded.forEach(name => this.addAudioToScene(name));
      } else {
        await this.fetchQuota?.();
      }
      this.audioUploadStatus = errors.length ? 'error' : 'ok';
      if (errors.length === 0) {
        this.audioUploadMessage = `${success} fichier${success > 1 ? 's' : ''} ajouté${success > 1 ? 's' : ''}.`;
      } else {
        const msg = [
          success > 0 ? `${success} fichier${success > 1 ? 's' : ''} ok.` : 'Aucun fichier ajouté.',
          errors.join(' | ')
        ].join(' ');
        this.audioUploadMessage = msg;
      }
      this.audioUploading = false;
    },
    // tenant audio
    async refreshTenantAudio() {
      if (!this.tenantId) return;
      this.tenantAudioLoading = true;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/audio`, { headers: this.headersAuth() });
        if (!res.ok) throw new Error(this.t('errors.audio', 'Audio'));
        this.tenantAudio = await res.json();
      } catch (e) {
        this.tenantAudio = [];
      }
      this.tenantAudioLoading = false;
    },
    handleTenantAudioDragStart(index) {
      this.tenantAudioDragIndex = index;
      this.tenantAudioDragOver = index;
    },
    handleTenantAudioDragOver(index) {
      this.tenantAudioDragOver = index;
    },
    handleTenantAudioDragEnd() {
      this.tenantAudioDragIndex = null;
      this.tenantAudioDragOver = null;
    },
    handleTenantAudioDrop() {
      if (this.tenantAudioDragIndex === null) return;
      const audio = this.tenantAudio[this.tenantAudioDragIndex];
      if (audio?.name) {
        this.addAudioToScene(audio.name);
      }
      this.tenantAudioDragIndex = null;
      this.tenantAudioDragOver = null;
    },
    tenantAudioFor(name) {
      if (!name) return null;
      return this.tenantAudio.find(a => a.name === name) || null;
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
    normalizeTensionColors(colors) {
      const sanitize = (c, fb) => {
        const val = this.sanitizeColor(c);
        return val ? val : fb;
      };
      return {
        level1: sanitize(colors?.level1, this.defaultTensionColors.level1),
        level2: sanitize(colors?.level2, this.defaultTensionColors.level2),
        level3: sanitize(colors?.level3, this.defaultTensionColors.level3),
        level4: sanitize(colors?.level4, this.defaultTensionColors.level4),
        level5: sanitize(colors?.level5, this.defaultTensionColors.level5)
      };
    },
    normalizeTensionLabels(labels) {
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
    normalizeTensionAudio(audios) {
      const levels = ['level1', 'level2', 'level3', 'level4', 'level5'];
      const src = (typeof audios === 'object' && audios) ? audios : {};
      const out = {};
      levels.forEach(l => {
        out[l] = (typeof src[l] === 'string' && src[l].trim().length) ? src[l] : null;
      });
      return out;
    },
    isSameTensionColors(a, b) {
      const levels = ['level1', 'level2', 'level3', 'level4', 'level5'];
      return levels.every(l => (a?.[l] || '') === (b?.[l] || ''));
    },
    isSameTensionLabels(a, b) {
      const levels = ['level1', 'level2', 'level3', 'level4', 'level5'];
      return levels.every(l => (a?.[l] || '') === (b?.[l] || ''));
    },
    isSameTensionAudio(a, b) {
      const levels = ['level1', 'level2', 'level3', 'level4', 'level5'];
      return levels.every(l => (a?.[l] || null) === (b?.[l] || null));
    },
    loadTensionFromSession(session) {
      const colors = this.normalizeTensionColors(session?.tensionColors);
      const labels = this.normalizeTensionLabels(session?.tensionLabels);
      const audios = this.normalizeTensionAudio(session?.tensionAudio);
      this.tensionEnabled = session?.tensionEnabled !== false;
      this.tensionFont = session?.tensionFont || this.defaultTensionFont;
      this.tensionColors = colors;
      this.tensionLabels = labels;
      this.tensionAudio = audios;
    },
    queueSaveTension() {
      if (this.tensionSaveTimer) clearTimeout(this.tensionSaveTimer);
      this.tensionSaveTimer = setTimeout(() => this.saveSessionTension(), 600);
    },
    resetTensionDefaults() {
      // Revenir aux valeurs par défaut chargées depuis /api/tension-default
      this.tensionEnabled = true;
      this.tensionFont = this.defaultTensionFont;
      this.tensionColors = { ...this.defaultTensionColors };
      this.tensionLabels = { ...this.defaultTensionLabels };
      this.tensionAudio = { ...this.defaultTensionAudio };
      this.tensionSaving = true;
      if (!this.tenantId || !this.session?.id) {
        this.tensionSaving = false;
        return;
      }
      fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.session.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
        body: JSON.stringify({ resetTensionDefaults: true })
      })
        .then(res => res.json().then(data => ({ ok: res.ok, data })).catch(() => ({ ok: res.ok, data: {} })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error(data.error || 'Réinitialisation tension');
          this.session = { ...this.session, ...data };
          this.tensionMessage = 'Tension réinitialisée.';
          this.tensionStatus = 'ok';
        })
        .catch(err => {
          this.tensionMessage = err?.message || 'Erreur tension';
          this.tensionStatus = 'error';
        })
        .finally(() => {
          this.tensionSaving = false;
        });
    },
    async saveSessionTension() {
      if (!this.tenantId || !this.session?.id) return;
      this.tensionSaveTimer = null;
      this.tensionSaving = true;
      const colors = this.normalizeTensionColors(this.tensionColors);
      const labels = this.normalizeTensionLabels(this.tensionLabels);
      const audios = { ...this.tensionAudio };
      Object.keys(audios).forEach(k => {
        if (!audios[k]) audios[k] = null;
      });
      try {
        const payload = { tensionEnabled: this.tensionEnabled };
        const hasCustom =
          this.tensionFont !== this.defaultTensionFont ||
          !this.isSameTensionColors(colors, this.defaultTensionColors) ||
          !this.isSameTensionLabels(labels, this.defaultTensionLabels) ||
          !this.isSameTensionAudio(audios, this.defaultTensionAudio);
        if (hasCustom) {
          payload.tensionFont = this.tensionFont;
          payload.tensionColors = colors;
          payload.tensionLabels = labels;
          payload.tensionAudio = audios;
        } else {
          payload.clearTension = true;
        }
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/sessions/${encodeURIComponent(this.session.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Sauvegarde tension');
        this.session = { ...this.session, ...data };
        this.tensionMessage = this.tensionEnabled ? 'Barre de tension activée.' : 'Barre de tension désactivée.';
        this.tensionStatus = 'ok';
      } catch (err) {
        this.tensionMessage = err?.message || 'Erreur tension';
        this.tensionStatus = 'error';
      } finally {
        this.tensionSaving = false;
      }
    },
    loadSceneNotesContent() {
      this.setNotesValue('');
    },
    async loadSceneNoteFile() {
      console.debug('[Notes] load file start', { scene: this.currentScene?.id, note: this.currentScene?.notes });
      this.noteName = this.currentScene?.notes || '';
      this.noteContentBuffer = '';
      if (!this.tenantId || !this.currentScene?.id || !this.currentScene?.notes) return;
      this.notesLoading = true;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.currentScene.id)}/note`, {
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('Note');
        const data = await res.json();
        const content = data?.content || '';
        this.noteName = data?.name || '';
        this.noteContentBuffer = content;
        console.debug('[Notes] load file success', { name: this.noteName, length: (content || '').length });
        this.setNotesValue(content || '');
      } catch (err) {
        console.error('[Notes] load file error', err);
        this.error = err?.message || 'Impossible de charger la note';
      } finally {
        this.notesLoading = false;
      }
    },
    async startNoteCreation() {
      if (!this.tenantId || !this.currentScene?.id) return;
      this.noteSaveDisabled = true;
      this.noteName = '';
      this.noteContentBuffer = '';
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.currentScene.id)}/note`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ content: '' })
        });
        if (!res.ok) throw new Error('Création note impossible');
        const data = await res.json().catch(() => ({}));
        if (data?.name) this.noteName = data.name;
        this.scenes = this.scenes.map(s => s.id === this.currentScene.id ? { ...s, notes: data?.name || s.notes } : s);
        const refreshed = this.scenes.find(s => s.id === this.currentScene.id);
        if (refreshed) this.currentScene = refreshed;
        this.activeTab = 'notes';
        await this.noteNextTick();
        this.setNotesValue('');
        if (!this.noteInputBound) {
          const el = await this.waitForNotesTextarea();
          if (el) {
            el.addEventListener('input', () => this.queueSaveSceneNotes());
            this.noteInputBound = true;
          }
        }
      } catch (e) {
        this.error = e?.message || 'Impossible de créer la note';
      } finally {
        this.noteSaveDisabled = false;
      }
    },
    queueSaveSceneNotes() {
      if (this.noteSaveDisabled) return;
      if (!this.getNotesTextarea()) return;
      if (this.noteSaveTimer) {
        clearTimeout(this.noteSaveTimer);
      }
      this.noteSaveTimer = setTimeout(() => {
        this.saveSceneNotes();
        this.noteSaveTimer = null;
      }, 800);
    },
    async saveSceneNotes() {
      if (!this.tenantId || !this.currentScene?.id || this.noteSaveDisabled) return;
      this.notesSaving = true;
      const content = this.getNotesValue();
      const previousTab = this.activeTab;
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.currentScene.id)}/note`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.headersAuth() },
          body: JSON.stringify({ content })
        });
        if (!res.ok) throw new Error('Sauvegarde note');
        const data = await res.json().catch(() => ({}));
        if (data?.name) this.noteName = data.name;
        // met à jour localement sans re-render complet
        const updatedScenes = this.scenes.map(s => s.id === this.currentScene.id ? { ...s, notes: data?.name || s.notes } : s);
        this.scenes = updatedScenes;
        const refreshed = updatedScenes.find(s => s.id === this.currentScene.id);
        if (refreshed) {
          this.currentScene = refreshed;
          this.selectedSceneId = refreshed.id;
        }
        if (previousTab === 'notes') this.activeTab = 'notes';
      } catch (err) {
        this.error = err?.message || 'Erreur lors de la sauvegarde des notes';
      } finally {
        this.notesSaving = false;
      }
    },
    async deleteSceneNote() {
      if (!this.tenantId || !this.currentScene?.id || !this.currentScene?.notes) return;
      this.noteSaveDisabled = true;
      if (this.noteSaveTimer) {
        clearTimeout(this.noteSaveTimer);
        this.noteSaveTimer = null;
      }
      try {
        const res = await fetch(`${this.API}/api/tenant/${this.tenantId}/scenes/${encodeURIComponent(this.currentScene.id)}/note`, {
          method: 'DELETE',
          headers: this.headersAuth()
        });
        if (!res.ok) throw new Error('Suppression note');
        this.noteName = '';
        this.noteContentBuffer = '';
        this.setNotesValue('');
        this.scenes = this.scenes.map(s => s.id === this.currentScene.id ? { ...s, notes: null } : s);
        const refreshed = this.scenes.find(s => s.id === this.currentScene.id);
        if (refreshed) this.currentScene = refreshed;
      } catch (e) {
        this.error = e?.message || 'Impossible de supprimer la note';
      } finally {
        this.noteSaveDisabled = false;
      }
    },
    normalizeAudio(arr) {
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
