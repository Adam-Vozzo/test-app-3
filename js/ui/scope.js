// Oscilloscope for the master bus, trigger-locked to a rising zero crossing so
// the waveform holds still.

export class Scope {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.data = new Float32Array(4096);
    this.phase = 0;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(width * dpr));
    this.h = Math.max(1, Math.round(height * dpr));
    this.dpr = dpr;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }

  draw(analyser, live, color) {
    const { g, w, h, dpr } = this;
    g.clearRect(0, 0, w, h);

    g.strokeStyle = 'rgba(232, 240, 210, 0.035)';
    g.lineWidth = 1;
    g.beginPath();
    const cols = 24;
    for (let i = 1; i < cols; i++) {
      const x = Math.round((i * w) / cols) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    g.stroke();

    const mid = h * 0.62;
    const span = 2048;
    let start = 0;
    const d = this.data;
    if (analyser && live) {
      analyser.getFloatTimeDomainData(d);
      for (let i = 1; i < d.length - span; i++) {
        if (d[i - 1] < 0 && d[i] >= 0) { start = i; break; }
      }
    } else {
      this.phase += 0.02;
      for (let i = 0; i < span; i++) d[i] = Math.sin(i * 0.018 + this.phase) * 0.012 + Math.sin(i * 0.055 - this.phase * 2) * 0.006;
    }

    g.save();
    g.strokeStyle = color;
    g.lineWidth = 1.4 * dpr;
    g.lineJoin = 'round';
    g.shadowColor = color;
    g.shadowBlur = 5 * dpr;
    g.beginPath();
    const amp = h * 0.26;
    for (let i = 0; i < span; i++) {
      const x = (i / (span - 1)) * w;
      const v = Math.max(-1.2, Math.min(1.2, d[start + i]));
      const y = mid - v * amp;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    g.restore();
  }
}
