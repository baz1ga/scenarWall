/**
 * PixelHourglass - lightweight sand hourglass renderer
 * API:
 *  - flip({ durationSeconds })
 *  - reset({ durationSeconds })
 *  - play()
 *  - stop()
 * The DOM must contain a wrapper with class "hourglass-wrapper" and a child ".hourglass-grid".
 */
(function () {
  class PixelHourglass {
    constructor(root, opts = {}) {
      if (!root) throw new Error('PixelHourglass: root element required');
      this.root = root;
      this.gridEl = root.querySelector('.hourglass-grid');
      if (!this.gridEl) {
        this.gridEl = document.createElement('div');
        this.gridEl.className = 'hourglass-grid';
        this.root.appendChild(this.gridEl);
      }

      this.w = opts.w || 24;
      this.h = opts.h || 35;
      this.neckHalf = opts.neckHalf ?? 0;
      this.topHalfSpan = opts.topHalfSpan || 10;
      this.fps = opts.fps || 50;
      this.durationSeconds = opts.durationSeconds || 60;
      this.fillPercent = opts.fillPercent ?? 97;

      this.cells = [];
      this.cellEls = [];
      this.grainsPerTick = 0;
      this.flowAccumulator = 0;
      this.capacityBottom = 0;
      this.targetFill = 0;
      this.running = false;
      this.timerId = null;
      this.elapsedMs = 0;
      this.lastTick = null;

      this.colors = {
        sand: '#ff9d00',
        wall: 'rgba(141,141,141,0.22)',
        empty: '#000'
      };

      this.buildGrid();
      this.reset();
    }

    buildGrid() {
      this.gridEl.style.gridTemplateColumns = `repeat(${this.w}, 1fr)`;
      this.gridEl.style.gridTemplateRows = `repeat(${this.h}, 1fr)`;
      this.gridEl.innerHTML = '';
      this.cellEls = [];
      for (let i = 0; i < this.w * this.h; i++) {
        const cell = document.createElement('div');
        cell.className = 'hourglass-cell';
        this.gridEl.appendChild(cell);
        this.cellEls.push(cell);
      }
    }

    normalizeDuration(val) {
      const n = Number(val);
      return Number.isFinite(n) && n > 0 ? n : this.durationSeconds;
    }

    spanAt(y) {
      const mid = Math.floor(this.h / 2);
      const dist = Math.abs(y - mid);
      return Math.max(this.neckHalf, Math.round(this.neckHalf + (dist / mid) * (this.topHalfSpan - this.neckHalf)));
    }

    isInside(x, y) {
      const center = Math.floor(this.w / 2);
      const span = this.spanAt(y);
      const neckMid = Math.floor(this.h / 2);
      if (y >= neckMid - 1 && y <= neckMid + 1) return x === center;
      return x >= center - span && x <= center + span;
    }

    makeWalls() {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          this.set(x, y, this.isInside(x, y) ? 0 : -1);
        }
      }
    }

    rowCapacity(y) {
      let count = 0;
      for (let x = 0; x < this.w; x++) {
        if (this.isInside(x, y)) count++;
      }
      return count;
    }

    computeCapacity() {
      const mid = Math.floor(this.h / 2);
      let count = 0;
      for (let y = mid; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.isInside(x, y)) count++;
        }
      }
      this.capacityBottom = count;
      this.targetFill = Math.floor(this.capacityBottom * 0.85);
    }

    fillTop() {
      const mid = Math.floor(this.h / 2) - 1;
      let capacityTop = 0;
      for (let y = 0; y <= mid; y++) capacityTop += this.rowCapacity(y);
      const target = Math.max(1, Math.min(capacityTop, Math.floor(capacityTop * (this.fillPercent / 100))));
      let remaining = target;
      for (let y = mid; y >= 0 && remaining > 0; y--) {
        for (let x = 0; x < this.w && remaining > 0; x++) {
          if (this.isInside(x, y)) {
            this.set(x, y, 1);
            remaining--;
          }
        }
      }
    }

    computeFlow() {
      const mid = Math.floor(this.h / 2);
      let count = 0;
      for (let y = 0; y < mid; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.get(x, y) === 1) count++;
        }
      }
      const totalTicks = this.durationSeconds * this.fps;
      this.grainsPerTick = count / totalTicks;
      this.flowAccumulator = 0;
    }

    get(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
      return this.cells[y * this.w + x];
    }

    set(x, y, v) {
      this.cells[y * this.w + x] = v;
    }

    swap(x1, y1, x2, y2) {
      const tmp = this.get(x1, y1);
      this.set(x1, y1, this.get(x2, y2));
      this.set(x2, y2, tmp);
    }

    countTopGrains() {
      const mid = Math.floor(this.h / 2);
      let count = 0;
      for (let y = 0; y < mid; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.get(x, y) === 1) count++;
        }
      }
      return count;
    }

    render() {
      for (let i = 0; i < this.cells.length; i++) {
        const v = this.cells[i];
        const el = this.cellEls[i];
        if (!el) continue;
        if (v === 1) {
          el.style.background = this.colors.sand;
          el.style.boxShadow = '0 0 3px rgba(255,157,0,0.6), 0 0 6px rgba(255,157,0,0.35)';
        } else if (v === -1) {
          el.style.background = this.colors.wall;
          el.style.boxShadow = 'none';
        } else {
          el.style.background = this.colors.empty;
          el.style.boxShadow = 'none';
        }
      }
    }

    reset(opts = {}) {
      if (opts.durationSeconds) this.durationSeconds = this.normalizeDuration(opts.durationSeconds);
      this.running = false;
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      this.elapsedMs = 0;
      this.lastTick = null;
      this.cells = new Array(this.w * this.h).fill(0);
      this.makeWalls();
      this.computeCapacity();
      this.fillTop();
      this.computeFlow();
      this.render();
    }

    play() {
      if (this.timerId) {
        clearInterval(this.timerId);
      }
      this.running = true;
      this.lastTick = performance.now();
      this.timerId = setInterval(() => this.update(), 1000 / this.fps);
    }

    stop() {
      this.running = false;
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    }

    flip(opts = {}) {
      this.reset({ durationSeconds: opts.durationSeconds });
      this.root.classList.add('flip-anim');
      setTimeout(() => this.root.classList.remove('flip-anim'), 800);
      this.play();
    }

    update() {
      if (!this.running) return;

      const now = performance.now();
      if (this.lastTick) this.elapsedMs += now - this.lastTick;
      this.lastTick = now;

      const remainingMs = Math.max(this.durationSeconds * 1000 - this.elapsedMs, 0);
      const remainingTop = this.countTopGrains();
      if (remainingMs === 0 && remainingTop === 0) {
        this.stop();
        return;
      }

      const mid = Math.floor(this.h / 2);
      const center = Math.floor(this.w / 2);
      const neckRow = mid - 1;

      this.flowAccumulator += this.grainsPerTick;
      let movesAllowed = Math.min(1, Math.floor(this.flowAccumulator));
      if (movesAllowed > 0) this.flowAccumulator -= movesAllowed;
      else movesAllowed = 0;
      if (remainingTop <= 1) movesAllowed = Math.max(movesAllowed, 1);

      let moved = false;
      for (let y = this.h - 2; y >= 0; y--) {
        for (let x = 0; x < this.w; x++) {
          if (this.get(x, y) !== 1) continue;

          const isNeckRow = y === neckRow && x === center;
          const targetIsNeckRow = (y + 1) === neckRow && x === center;

          if (this.get(x, y + 1) === 0) {
            if (isNeckRow || targetIsNeckRow) {
              if (movesAllowed > 0) {
                this.swap(x, y, x, y + 1);
                movesAllowed--;
                moved = true;
              }
              continue;
            }
            this.swap(x, y, x, y + 1);
            moved = true;
            continue;
          }
          if (this.get(x - 1, y + 1) === 0) { this.swap(x, y, x - 1, y + 1); moved = true; continue; }
          if (this.get(x + 1, y + 1) === 0) { this.swap(x, y, x + 1, y + 1); moved = true; continue; }
        }
      }

      if (moved) this.render();
    }
  }

  window.PixelHourglass = PixelHourglass;
})();
