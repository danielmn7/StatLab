/*
 * charts.js — SVG figure engine for StatLab.
 * Each builder returns an SVG markup string. Standalone (no stats dependency).
 */
const Charts = (function () {
  'use strict';

  const PALETTE = ['#0d9488', '#2563eb', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#65a30d', '#db2777'];

  // ---- numeric helpers ----
  function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
  function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); }
  function sem(a) { return sd(a) / Math.sqrt(a.length); }
  function quantile(s, p) { const n = s.length; if (n === 1) return s[0]; const h = (n - 1) * p, lo = Math.floor(h); return s[lo] + (h - lo) * (s[Math.min(lo + 1, n - 1)] - s[lo]); }
  function tcrit95(df) { // small lookup, good enough for CI whiskers
    const tbl = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 20: 2.086, 30: 2.042, 60: 2.000 };
    if (tbl[df]) return tbl[df]; if (df > 60) return 1.96; const ks = Object.keys(tbl).map(Number).sort((a, b) => a - b); let k = ks[0]; for (const kk of ks) if (kk <= df) k = kk; return tbl[k]; }

  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range || 1));
    const f = (range || 1) / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function niceTicks(min, max, n = 5) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    const range = niceNum(max - min, false);
    const step = niceNum(range / (n - 1), true);
    const nmin = Math.floor(min / step) * step;
    const nmax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = nmin; v <= nmax + step * 0.5; v += step) ticks.push(+v.toPrecision(12));
    return { ticks, min: nmin, max: nmax };
  }
  function fmt(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-3) return v.toExponential(1);
    return (+v.toPrecision(4)).toString();
  }
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  // ---- shared frame ----
  function frame(opts) {
    const W = opts.width || 580, H = opts.height || 420;
    const m = Object.assign({ top: 46, right: 24, bottom: 64, left: 70 }, opts.margin || {});
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    return { W, H, m, pw, ph, x0: m.left, x1: m.left + pw, y0: m.top, y1: m.top + ph };
  }
  function open(f, title) {
    return `<svg viewBox="0 0 ${f.W} ${f.H}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" style="background:#fff">` +
      `<rect x="0" y="0" width="${f.W}" height="${f.H}" fill="#ffffff"/>` +
      (title ? `<text x="${f.W / 2}" y="26" text-anchor="middle" font-size="15.5" font-weight="650" fill="#1c2733">${esc(title)}</text>` : '');
  }
  function yAxis(f, sc, label) {
    let s = `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x0}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    sc.ticks.forEach((t) => {
      const y = sc.toY(t);
      if (y < f.y0 - 0.5 || y > f.y1 + 0.5) return;
      s += `<line x1="${f.x0 - 5}" y1="${y}" x2="${f.x0}" y2="${y}" stroke="#1c2733" stroke-width="1.1"/>`;
      s += `<text x="${f.x0 - 9}" y="${y + 4}" text-anchor="end" font-size="11.5" fill="#5b6b7b">${fmt(t)}</text>`;
    });
    if (label) s += `<text transform="translate(${18},${(f.y0 + f.y1) / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2733">${esc(label)}</text>`;
    return s;
  }
  function makeYScale(f, lo, hi, nticks) {
    const { ticks, min, max } = niceTicks(lo, hi, nticks || 6);
    const toY = (v) => f.y1 - ((v - min) / (max - min)) * f.ph;
    return { ticks, min, max, toY };
  }

  // significance brackets above plot. sig:[{i,j,label}] referencing x-centers cx[]
  function sigBrackets(f, cx, topAt, sig, color) {
    if (!sig || !sig.length) return '';
    let s = '';
    let level = 0;
    const baseY = Math.min(...topAt) - 14;
    sig.forEach((b) => {
      const x1 = cx[b.i], x2 = cx[b.j];
      const y = baseY - level * 22;
      const h = 6;
      s += `<path d="M${x1} ${y} L${x1} ${y - h} L${x2} ${y - h} L${x2} ${y}" fill="none" stroke="#1c2733" stroke-width="1.2"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${y - h - 4}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2733">${esc(b.label)}</text>`;
      level++;
    });
    return s;
  }

  // ---- 1. bar chart with error bars ----
  function barChart(groups, opts = {}) {
    opts = opts || {};
    const f = frame(opts);
    const colors = opts.colors || PALETTE;
    const errType = opts.errorType || 'sem';
    const stats = groups.map((g) => {
      const m = mean(g.values), s = sd(g.values), se = sem(g.values);
      let err = errType === 'sd' ? s : errType === 'ci95' ? tcrit95(g.values.length - 1) * se : errType === 'none' ? 0 : se;
      return { name: g.name, m, err, values: g.values };
    });
    let lo = 0, hi = Math.max(...stats.map((s) => s.m + s.err), ...groups.flatMap((g) => opts.showPoints ? g.values : []));
    let dmin = Math.min(0, ...stats.map((s) => s.m - s.err), ...groups.flatMap((g) => opts.showPoints ? g.values : []));
    lo = dmin; hi = hi * 1.08;
    const sc = makeYScale(f, lo, hi);
    const n = groups.length;
    const slot = f.pw / n, bw = Math.min(58, slot * 0.6);
    let s = open(f, opts.title);
    // zero line / y axis
    s += yAxis(f, sc, opts.yLabel || 'Value');
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    const cx = [], tops = [];
    stats.forEach((st, i) => {
      const x = f.x0 + slot * i + slot / 2;
      cx.push(x);
      const yTop = sc.toY(st.m), yBase = sc.toY(Math.max(0, sc.min));
      const col = colors[i % colors.length];
      s += `<rect x="${x - bw / 2}" y="${Math.min(yTop, yBase)}" width="${bw}" height="${Math.abs(yBase - yTop)}" fill="${col}" fill-opacity="0.82" stroke="${col}" stroke-width="1.2" rx="1.5"/>`;
      // error bar
      if (st.err > 0) {
        const yhi = sc.toY(st.m + st.err), ylo = sc.toY(st.m - st.err);
        s += `<line x1="${x}" y1="${yhi}" x2="${x}" y2="${st.m >= 0 ? yTop : ylo}" stroke="#1c2733" stroke-width="1.3"/>`;
        s += `<line x1="${x - 7}" y1="${yhi}" x2="${x + 7}" y2="${yhi}" stroke="#1c2733" stroke-width="1.3"/>`;
        if (opts.errorBothSides !== false) { s += `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${ylo}" stroke="#1c2733" stroke-width="1.3"/>`; s += `<line x1="${x - 7}" y1="${ylo}" x2="${x + 7}" y2="${ylo}" stroke="#1c2733" stroke-width="1.3"/>`; }
        tops.push(yhi);
      } else tops.push(yTop);
      // points
      if (opts.showPoints) {
        let seed = i * 99 + 7;
        st.values.forEach((v) => { seed = (seed * 9301 + 49297) % 233280; const j = (seed / 233280 - 0.5) * bw * 0.7; s += `<circle cx="${x + j}" cy="${sc.toY(v)}" r="3" fill="#1c2733" fill-opacity="0.55"/>`; });
      }
      // x label
      s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="12" fill="#1c2733">${esc(st.name)}</text>`;
    });
    s += sigBrackets(f, cx, tops, opts.sig);
    s += errLegend(f, errType);
    s += '</svg>';
    return s;
  }

  function errLegend(f, errType) {
    const label = { sd: 'mean ± SD', sem: 'mean ± SEM', ci95: 'mean ± 95% CI', none: 'mean' }[errType] || '';
    if (!label) return '';
    return `<text x="${f.x1}" y="${f.H - 8}" text-anchor="end" font-size="10.5" fill="#8696a7">${label}</text>`;
  }

  // ---- 2. column dot plot (individual points + mean/error line) ----
  function dotPlot(groups, opts = {}) {
    const f = frame(opts);
    const colors = opts.colors || PALETTE;
    const errType = opts.errorType || 'sd';
    const all = groups.flatMap((g) => g.values);
    const sc = makeYScale(f, Math.min(...all), Math.max(...all), 6);
    const n = groups.length, slot = f.pw / n;
    let s = open(f, opts.title);
    s += yAxis(f, sc, opts.yLabel || 'Value');
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    const cx = [], tops = [];
    groups.forEach((g, i) => {
      const x = f.x0 + slot * i + slot / 2; cx.push(x);
      const col = colors[i % colors.length];
      const m = mean(g.values), se = sem(g.values), sdv = sd(g.values);
      const err = errType === 'sem' ? se : errType === 'ci95' ? tcrit95(g.values.length - 1) * se : sdv;
      let seed = i * 131 + 17;
      g.values.forEach((v) => { seed = (seed * 9301 + 49297) % 233280; const j = (seed / 233280 - 0.5) * Math.min(46, slot * 0.5); s += `<circle cx="${x + j}" cy="${sc.toY(v)}" r="3.6" fill="${col}" fill-opacity="0.78" stroke="${col}" stroke-width="0.8"/>`; });
      // mean line + error
      const wm = 22;
      s += `<line x1="${x - wm}" y1="${sc.toY(m)}" x2="${x + wm}" y2="${sc.toY(m)}" stroke="#1c2733" stroke-width="2"/>`;
      if (errType !== 'none') {
        s += `<line x1="${x}" y1="${sc.toY(m - err)}" x2="${x}" y2="${sc.toY(m + err)}" stroke="#1c2733" stroke-width="1.3"/>`;
        s += `<line x1="${x - 8}" y1="${sc.toY(m + err)}" x2="${x + 8}" y2="${sc.toY(m + err)}" stroke="#1c2733" stroke-width="1.3"/>`;
        s += `<line x1="${x - 8}" y1="${sc.toY(m - err)}" x2="${x + 8}" y2="${sc.toY(m - err)}" stroke="#1c2733" stroke-width="1.3"/>`;
        tops.push(sc.toY(m + err));
      } else tops.push(sc.toY(Math.max(...g.values)));
      s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="12" fill="#1c2733">${esc(g.name)}</text>`;
    });
    s += sigBrackets(f, cx, tops, opts.sig);
    s += errLegend(f, errType);
    s += '</svg>';
    return s;
  }

  // ---- 3. box-and-whisker ----
  function boxPlot(groups, opts = {}) {
    const f = frame(opts);
    const colors = opts.colors || PALETTE;
    const all = groups.flatMap((g) => g.values);
    const sc = makeYScale(f, Math.min(...all), Math.max(...all), 6);
    const n = groups.length, slot = f.pw / n, bw = Math.min(48, slot * 0.5);
    let s = open(f, opts.title);
    s += yAxis(f, sc, opts.yLabel || 'Value');
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    const cx = [], tops = [];
    groups.forEach((g, i) => {
      const x = f.x0 + slot * i + slot / 2; cx.push(x);
      const col = colors[i % colors.length];
      const sorted = g.values.slice().sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25), med = quantile(sorted, 0.5), q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      const lowF = q1 - 1.5 * iqr, highF = q3 + 1.5 * iqr;
      const inl = sorted.filter((v) => v >= lowF && v <= highF);
      const wlo = Math.min(...inl), whi = Math.max(...inl);
      s += `<rect x="${x - bw / 2}" y="${sc.toY(q3)}" width="${bw}" height="${sc.toY(q1) - sc.toY(q3)}" fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-width="1.5"/>`;
      s += `<line x1="${x - bw / 2}" y1="${sc.toY(med)}" x2="${x + bw / 2}" y2="${sc.toY(med)}" stroke="${col}" stroke-width="2.2"/>`;
      s += `<line x1="${x}" y1="${sc.toY(q3)}" x2="${x}" y2="${sc.toY(whi)}" stroke="${col}" stroke-width="1.3"/>`;
      s += `<line x1="${x}" y1="${sc.toY(q1)}" x2="${x}" y2="${sc.toY(wlo)}" stroke="${col}" stroke-width="1.3"/>`;
      s += `<line x1="${x - bw / 4}" y1="${sc.toY(whi)}" x2="${x + bw / 4}" y2="${sc.toY(whi)}" stroke="${col}" stroke-width="1.3"/>`;
      s += `<line x1="${x - bw / 4}" y1="${sc.toY(wlo)}" x2="${x + bw / 4}" y2="${sc.toY(wlo)}" stroke="${col}" stroke-width="1.3"/>`;
      sorted.filter((v) => v < lowF || v > highF).forEach((v) => { s += `<circle cx="${x}" cy="${sc.toY(v)}" r="3" fill="none" stroke="${col}" stroke-width="1.2"/>`; });
      tops.push(sc.toY(whi));
      s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="12" fill="#1c2733">${esc(g.name)}</text>`;
    });
    s += sigBrackets(f, cx, tops, opts.sig);
    s += `<text x="${f.x1}" y="${f.H - 8}" text-anchor="end" font-size="10.5" fill="#8696a7">box: median &amp; IQR · whiskers: 1.5×IQR</text>`;
    s += '</svg>';
    return s;
  }

  // ---- 4. paired before/after ----
  function pairedPlot(colA, colB, opts = {}) {
    const f = frame(opts);
    const pairs = [];
    const n = Math.min(colA.length, colB.length);
    for (let i = 0; i < n; i++) if (colA[i] !== '' && colB[i] !== '' && !isNaN(+colA[i]) && !isNaN(+colB[i])) pairs.push([+colA[i], +colB[i]]);
    const all = pairs.flat();
    const sc = makeYScale(f, Math.min(...all), Math.max(...all), 6);
    const xA = f.x0 + f.pw * 0.32, xB = f.x0 + f.pw * 0.68;
    let s = open(f, opts.title);
    s += yAxis(f, sc, opts.yLabel || 'Value');
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    pairs.forEach(([a, b]) => {
      const up = b >= a;
      s += `<line x1="${xA}" y1="${sc.toY(a)}" x2="${xB}" y2="${sc.toY(b)}" stroke="${up ? '#dc2626' : '#2563eb'}" stroke-width="1.1" stroke-opacity="0.55"/>`;
      s += `<circle cx="${xA}" cy="${sc.toY(a)}" r="3.6" fill="#0d9488"/>`;
      s += `<circle cx="${xB}" cy="${sc.toY(b)}" r="3.6" fill="#7c3aed"/>`;
    });
    s += `<text x="${xA}" y="${f.y1 + 18}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2733">${esc(opts.labelA || 'Before')}</text>`;
    s += `<text x="${xB}" y="${f.y1 + 18}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2733">${esc(opts.labelB || 'After')}</text>`;
    s += '</svg>';
    return s;
  }

  // ---- 5. XY scatter + regression ----
  function xyPlot(xs, ys, opts = {}) {
    const f = frame(opts);
    const sc = makeYScale(f, Math.min(...ys), Math.max(...ys), 6);
    const scx = (() => { const { ticks, min, max } = niceTicks(Math.min(...xs), Math.max(...xs), 6); return { ticks, min, max, toX: (v) => f.x0 + ((v - min) / (max - min)) * f.pw }; })();
    let s = open(f, opts.title);
    s += yAxis(f, sc, opts.yLabel || 'Y');
    // x axis
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    scx.ticks.forEach((t) => { const x = scx.toX(t); if (x < f.x0 - 0.5 || x > f.x1 + 0.5) return; s += `<line x1="${x}" y1="${f.y1}" x2="${x}" y2="${f.y1 + 5}" stroke="#1c2733" stroke-width="1.1"/>`; s += `<text x="${x}" y="${f.y1 + 19}" text-anchor="middle" font-size="11.5" fill="#5b6b7b">${fmt(t)}</text>`; });
    s += `<text x="${(f.x0 + f.x1) / 2}" y="${f.H - 14}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2733">${esc(opts.xLabel || 'X')}</text>`;
    // regression line + CI band
    if (opts.regression) {
      const r = opts.regression;
      const xmin = scx.min, xmax = scx.max;
      const band = [];
      const N = 40;
      for (let k = 0; k <= N; k++) {
        const xv = xmin + (xmax - xmin) * k / N;
        const yv = r.intercept + r.slope * xv;
        const seFit = Math.sqrt(r._mse * (1 / r.n + (xv - r._mx) ** 2 / r._sxx));
        band.push({ x: scx.toX(xv), y: sc.toY(yv), yhi: sc.toY(yv + r._tcrit * seFit), ylo: sc.toY(yv - r._tcrit * seFit) });
      }
      let up = `M${band[0].x} ${band[0].yhi}`, dn = '';
      band.forEach((p) => { up += ` L${p.x} ${p.yhi}`; });
      for (let k = band.length - 1; k >= 0; k--) up += ` L${band[k].x} ${band[k].ylo}`;
      s += `<path d="${up} Z" fill="#0d9488" fill-opacity="0.12"/>`;
      s += `<line x1="${band[0].x}" y1="${band[0].y}" x2="${band[N].x}" y2="${band[N].y}" stroke="#0d9488" stroke-width="2"/>`;
    }
    // points
    for (let i = 0; i < xs.length; i++) s += `<circle cx="${scx.toX(xs[i])}" cy="${sc.toY(ys[i])}" r="3.8" fill="#2563eb" fill-opacity="0.75" stroke="#1d4ed8" stroke-width="0.8"/>`;
    if (opts.annotation) s += `<text x="${f.x0 + 10}" y="${f.y0 + 14}" font-size="11.5" fill="#5b6b7b">${esc(opts.annotation)}</text>`;
    s += '</svg>';
    return s;
  }

  // ---- 6. Kaplan-Meier survival ----
  function survivalPlot(curves, opts = {}) {
    // curves: [{name, steps:[{time,S,lo,hi,censorOnly}], censorTimes:[], color}]
    const f = frame(Object.assign({ margin: { top: 46, right: 24, bottom: 92, left: 66 } }, opts));
    const colors = opts.colors || PALETTE;
    const maxT = Math.max(...curves.flatMap((c) => c.steps.map((s) => s.time)), 1);
    const scx = (() => { const { ticks, min, max } = niceTicks(0, maxT, 6); return { ticks, min: 0, max, toX: (v) => f.x0 + (v / max) * f.pw }; })();
    const toY = (sv) => f.y1 - sv * f.ph;
    let s = open(f, opts.title);
    // y axis 0..1
    s += `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x0}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    for (let p = 0; p <= 1.0001; p += 0.25) { const y = toY(p); s += `<line x1="${f.x0 - 5}" y1="${y}" x2="${f.x0}" y2="${y}" stroke="#1c2733" stroke-width="1.1"/>`; s += `<text x="${f.x0 - 9}" y="${y + 4}" text-anchor="end" font-size="11.5" fill="#5b6b7b">${opts.percent ? p * 100 : p.toFixed(2)}</text>`; }
    s += `<text transform="translate(16,${(f.y0 + f.y1) / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2733">${esc(opts.yLabel || (opts.percent ? 'Percent survival' : 'Survival probability'))}</text>`;
    // x axis
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    scx.ticks.forEach((t) => { const x = scx.toX(t); if (x < f.x0 - 0.5 || x > f.x1 + 0.5) return; s += `<line x1="${x}" y1="${f.y1}" x2="${x}" y2="${f.y1 + 5}" stroke="#1c2733" stroke-width="1.1"/>`; s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="11.5" fill="#5b6b7b">${fmt(t)}</text>`; });
    s += `<text x="${(f.x0 + f.x1) / 2}" y="${f.y1 + 40}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2733">${esc(opts.xLabel || 'Time')}</text>`;
    // curves
    curves.forEach((c, ci) => {
      const col = c.color || colors[ci % colors.length];
      let prevX = scx.toX(0), prevS = 1;
      let path = `M${prevX} ${toY(1)}`;
      c.steps.forEach((st) => {
        const x = scx.toX(st.time);
        path += ` L${x} ${toY(prevS)}`;        // horizontal
        path += ` L${x} ${toY(st.S)}`;          // drop
        prevS = st.S; prevX = x;
      });
      path += ` L${scx.toX(scx.max)} ${toY(prevS)}`;
      if (opts.showCI) {
        // CI band as light step area
        let bu = '', bl = '';
        let ps = 1, plo = 1, phi = 1, px = scx.toX(0);
        const up = [], dn = [];
        up.push([px, toY(1)]); dn.push([px, toY(1)]);
        c.steps.forEach((st) => { const x = scx.toX(st.time); up.push([x, toY(phi)]); dn.push([x, toY(plo)]); phi = st.hi != null ? st.hi : st.S; plo = st.lo != null ? st.lo : st.S; up.push([x, toY(phi)]); dn.push([x, toY(plo)]); });
        up.push([scx.toX(scx.max), toY(phi)]); dn.push([scx.toX(scx.max), toY(plo)]);
        let band = `M${up[0][0]} ${up[0][1]}`; up.forEach((p) => band += ` L${p[0]} ${p[1]}`); for (let k = dn.length - 1; k >= 0; k--) band += ` L${dn[k][0]} ${dn[k][1]}`;
        s += `<path d="${band} Z" fill="${col}" fill-opacity="0.1"/>`;
      }
      s += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
      // censor ticks
      (c.censorTimes || []).forEach((t) => { const st = lastSAt(c.steps, t); const x = scx.toX(t), y = toY(st); s += `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="${col}" stroke-width="1.6"/>`; });
    });
    // legend
    curves.forEach((c, ci) => { const col = c.color || colors[ci % colors.length]; const lx = f.x1 - 130, ly = f.y0 + 14 + ci * 18; s += `<line x1="${lx}" y1="${ly}" x2="${lx + 22}" y2="${ly}" stroke="${col}" stroke-width="2.6"/>`; s += `<text x="${lx + 28}" y="${ly + 4}" font-size="12" fill="#1c2733">${esc(c.name)}</text>`; });
    // numbers at risk
    if (opts.atRisk) {
      const ly0 = f.y1 + 56;
      s += `<text x="${f.x0 - 6}" y="${ly0}" text-anchor="end" font-size="10" fill="#8696a7">At risk</text>`;
      curves.forEach((c, ci) => {
        const col = c.color || colors[ci % colors.length];
        const y = ly0 + ci * 14;
        s += `<text x="${f.x0 - 6}" y="${y + 14}" text-anchor="end" font-size="10" fill="${col}">${esc(c.name)}</text>`;
        scx.ticks.forEach((t) => { if (scx.toX(t) < f.x0 - 0.5 || scx.toX(t) > f.x1 + 0.5) return; const nr = atRiskAt(c.steps, t, c.n0); s += `<text x="${scx.toX(t)}" y="${y + 14}" text-anchor="middle" font-size="10" fill="${col}">${nr}</text>`; });
      });
    }
    s += '</svg>';
    return s;
  }
  function lastSAt(steps, t) { let S = 1; for (const st of steps) { if (st.time <= t) S = st.S; else break; } return S; }
  // number at risk at time t = those who entered minus those who left strictly before t
  function atRiskAt(steps, t, n0) { let removed = 0; for (const st of steps) { if (st.time < t) removed += (st.d || 0) + (st.c || 0); else break; } return Math.max(n0 - removed, 0); }

  // ---- 7. grouped bar (two-way): categories = rows, bars within = column groups ----
  function groupedBar(cells, rowNames, colNames, opts = {}) {
    const f = frame(Object.assign({ margin: { top: 46, right: 24, bottom: 64, left: 70 } }, opts));
    const colors = opts.colors || PALETTE;
    const errType = opts.errorType || 'sem';
    const a = rowNames.length, b = colNames.length;
    const stat = (v) => { const m = mean(v), se = sem(v), sdv = sd(v); let err = errType === 'sd' ? sdv : errType === 'ci95' ? tcrit95(v.length - 1) * se : errType === 'none' ? 0 : se; return { m, err }; };
    const cs = cells.map((row) => row.map((c) => (c && c.length) ? Object.assign(stat(c), { n: c.length }) : { m: 0, err: 0, empty: true }));
    let hi = 0, lo = 0;
    cs.forEach((row) => row.forEach((c) => { if (!c.empty) { hi = Math.max(hi, c.m + c.err); lo = Math.min(lo, c.m - c.err); } }));
    const sc = makeYScale(f, Math.min(0, lo), hi * 1.08);
    let s = open(f, opts.title);
    s += yAxis(f, sc, opts.yLabel || 'Value');
    s += `<line x1="${f.x0}" y1="${sc.toY(Math.max(0, sc.min))}" x2="${f.x1}" y2="${sc.toY(Math.max(0, sc.min))}" stroke="#1c2733" stroke-width="1.3"/>`;
    const slot = f.pw / a;
    const groupW = Math.min(slot * 0.82, b * 46);
    const barW = (groupW / b) * 0.8;
    const barX = []; // barX[i][j]
    for (let i = 0; i < a; i++) {
      const cx0 = f.x0 + slot * i + slot / 2; barX[i] = [];
      for (let j = 0; j < b; j++) {
        const bx = cx0 - groupW / 2 + groupW * (j + 0.5) / b;
        barX[i][j] = bx;
        const c = cs[i][j]; if (c.empty) continue;
        const col = colors[j % colors.length];
        const yTop = sc.toY(c.m), yBase = sc.toY(Math.max(0, sc.min));
        s += `<rect x="${bx - barW / 2}" y="${Math.min(yTop, yBase)}" width="${barW}" height="${Math.abs(yBase - yTop)}" fill="${col}" fill-opacity="0.82" stroke="${col}" stroke-width="1.1" rx="1.5"/>`;
        if (c.err > 0) {
          const yhi = sc.toY(c.m + c.err), ylo = sc.toY(c.m - c.err);
          s += `<line x1="${bx}" y1="${yhi}" x2="${bx}" y2="${ylo}" stroke="#1c2733" stroke-width="1.2"/>`;
          s += `<line x1="${bx - 5}" y1="${yhi}" x2="${bx + 5}" y2="${yhi}" stroke="#1c2733" stroke-width="1.2"/>`;
          s += `<line x1="${bx - 5}" y1="${ylo}" x2="${bx + 5}" y2="${ylo}" stroke="#1c2733" stroke-width="1.2"/>`;
        }
      }
      s += `<text x="${cx0}" y="${f.y1 + 18}" text-anchor="middle" font-size="12" fill="#1c2733">${esc(rowNames[i])}</text>`;
    }
    // significance brackets within categories: sig=[{cat,ja,jb,label}]
    (opts.sig || []).forEach((g) => {
      const x1 = barX[g.cat][g.ja], x2 = barX[g.cat][g.jb];
      const top = Math.min(sc.toY(cs[g.cat][g.ja].m + cs[g.cat][g.ja].err), sc.toY(cs[g.cat][g.jb].m + cs[g.cat][g.jb].err)) - 12;
      s += `<path d="M${x1} ${top} L${x1} ${top - 5} L${x2} ${top - 5} L${x2} ${top}" fill="none" stroke="#1c2733" stroke-width="1.1"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${top - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="#1c2733">${esc(g.label)}</text>`;
    });
    // legend
    colNames.forEach((cn, j) => { const col = colors[j % colors.length]; const lx = f.x1 - 118, ly = f.y0 + 12 + j * 17; s += `<rect x="${lx}" y="${ly - 8}" width="12" height="12" fill="${col}" fill-opacity="0.82" stroke="${col}"/>`; s += `<text x="${lx + 18}" y="${ly + 2}" font-size="11.5" fill="#1c2733">${esc(cn)}</text>`; });
    s += errLegend(f, errType);
    s += '</svg>';
    return s;
  }

  // ---- export ----
  function svgToPNG(svgString, scale, cb) {
    scale = scale || 2;
    const vb = svgString.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const w = vb ? +vb[1] : 580, h = vb ? +vb[2] : 420;
    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale; canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(cb, 'image/png');
    };
    img.src = url;
  }

  return { PALETTE, barChart, dotPlot, boxPlot, pairedPlot, xyPlot, survivalPlot, groupedBar, svgToPNG, niceTicks };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Charts;
