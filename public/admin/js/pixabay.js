export function pixabayMixin() {
  return {
    pixabayKey: window.PIXABAY_KEY || '',
    pixabayQuery: '',
    pixabayLoading: false,
    pixabayResults: [],
    pixabayMessage: '',
    pixabayStatus: 'ok',
    pixabayInitialized: false,

    async searchPixabay(options = {}) {
      const { allowEmpty = false } = options;
      if (!this.pixabayKey) {
        this.pixabayMessage = 'Clé API Pixabay manquante.';
        this.pixabayStatus = 'error';
        return;
      }
      const qTrim = (this.pixabayQuery || '').trim();
      if (!qTrim && !allowEmpty) return;
      this.pixabayLoading = true;
      this.pixabayMessage = '';
      this.pixabayStatus = 'ok';
      try {
        const url = new URL('https://pixabay.com/api/');
        url.searchParams.set('key', this.pixabayKey);
        url.searchParams.set('image_type', 'photo');
        url.searchParams.set('per_page', '24');
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
        const hits = Array.isArray(data?.hits) ? data.hits : [];
        this.pixabayResults = hits.filter(h => h.type === 'photo' || h.type === 'illustration');
        if (this.pixabayResults.length === 0) {
          this.pixabayMessage = 'Aucun résultat.';
          this.pixabayStatus = 'error';
        } else {
          this.pixabayInitialized = true;
        }
      } catch (err) {
        this.pixabayResults = [];
        this.pixabayMessage = err?.message || 'Erreur Pixabay.';
        this.pixabayStatus = 'error';
      }
      this.pixabayLoading = false;
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
        this.pixabayMessage = 'Image importée depuis Pixabay.';
        this.pixabayStatus = 'ok';
      } else {
        this.pixabayMessage = this.uploadUrlMessage || 'Import Pixabay impossible.';
        this.pixabayStatus = 'error';
      }
    }
  };
}
