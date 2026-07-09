/*
 * charts.js — SVG figure engine for StatLab.
 * Each builder returns an SVG markup string. Standalone (no stats dependency).
 */
const Charts = (function () {
  'use strict';

  const PALETTE = ['#0d9488', '#2563eb', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#65a30d', '#db2777'];

  // Curated palette library for the figure "Color palette" picker. Colors map to
  // discrete groups/series, so these are categorical (or perceptual schemes sampled
  // to discrete swatches). Drawn from the schemes scientists reach for — ColorBrewer,
  // Tableau, matplotlib/viridis, ggsci journal themes, and colorblind-safe sets
  // (Okabe–Ito, Paul Tol, IBM). `cb:true` marks palettes that stay distinguishable
  // under common color-vision deficiencies. `group` drives the picker's subheaders.
  const PALETTES = [
    // --- general categorical ---
    { id: 'statlab', name: 'StatLab', group: 'General', colors: PALETTE },
    { id: 'tableau10', name: 'Tableau 10', group: 'General', colors: ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'] },
    { id: 'd3cat10', name: 'D3 Category 10', group: 'General', colors: ['#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B', '#E377C2', '#7F7F7F', '#BCBD22', '#17BECF'] },
    { id: 'set1', name: 'ColorBrewer Set1', group: 'General', colors: ['#E41A1C', '#377EB8', '#4DAF4A', '#984EA3', '#FF7F00', '#FFFF33', '#A65628', '#F781BF', '#999999'] },
    { id: 'set2', name: 'ColorBrewer Set2', group: 'General', colors: ['#66C2A5', '#FC8D62', '#8DA0CB', '#E78AC3', '#A6D854', '#FFD92F', '#E5C494', '#B3B3B3'] },
    { id: 'dark2', name: 'ColorBrewer Dark2', group: 'General', colors: ['#1B9E77', '#D95F02', '#7570B3', '#E7298A', '#66A61E', '#E6AB02', '#A6761D', '#666666'] },
    { id: 'set3', name: 'ColorBrewer Set3', group: 'General', colors: ['#8DD3C7', '#FFFFB3', '#BEBADA', '#FB8072', '#80B1D3', '#FDB462', '#B3DE69', '#FCCDE5', '#D9D9D9', '#BC80BD', '#CCEBC5', '#FFED6F'] },
    { id: 'paired', name: 'ColorBrewer Paired', group: 'General', colors: ['#A6CEE3', '#1F78B4', '#B2DF8A', '#33A02C', '#FB9A99', '#E31A1C', '#FDBF6F', '#FF7F00', '#CAB2D6', '#6A3D9A', '#FFFF99', '#B15928'] },
    { id: 'accent', name: 'ColorBrewer Accent', group: 'General', colors: ['#7FC97F', '#BEAED4', '#FDC086', '#FFFF99', '#386CB0', '#F0027F', '#BF5B17', '#666666'] },
    { id: 'pastel1', name: 'ColorBrewer Pastel1', group: 'General', colors: ['#FBB4AE', '#B3CDE3', '#CCEBC5', '#DECBE4', '#FED9A6', '#FFFFCC', '#E5D8BD', '#FDDAEC', '#F2F2F2'] },
    { id: 'vivid', name: 'Vivid (Prism-style)', group: 'General', colors: ['#023EFF', '#FF7C00', '#1AC938', '#E8000B', '#8B2BE2', '#9F4800', '#F14CC1', '#A3A3A3', '#FFC400', '#00D7FF'] },
    { id: 'muted', name: 'Muted', group: 'General', colors: ['#4878D0', '#EE854A', '#6ACC64', '#D65F5F', '#956CB4', '#8C613C', '#DC7EC0', '#797979', '#D5BB67', '#82C6E2'] },
    // --- journal (ggsci) ---
    { id: 'npg', name: 'Nature (NPG)', group: 'Journal', colors: ['#E64B35', '#4DBBD5', '#00A087', '#3C5488', '#F39B7F', '#8491B4', '#91D1C2', '#DC0000', '#7E6148', '#B09C85'] },
    { id: 'aaas', name: 'Science (AAAS)', group: 'Journal', colors: ['#3B4992', '#EE0000', '#008B45', '#631879', '#008280', '#BB0021', '#5F559B', '#A20056', '#808180', '#1B1919'] },
    { id: 'lancet', name: 'Lancet', group: 'Journal', colors: ['#00468B', '#ED0000', '#42B540', '#0099B4', '#925E9F', '#FDAF91', '#AD002A', '#ADB6B6', '#1B1919'] },
    { id: 'nejm', name: 'NEJM', group: 'Journal', colors: ['#BC3C29', '#0072B5', '#E18727', '#20854E', '#7876B1', '#6F99AD', '#FFDC91', '#EE4C97'] },
    { id: 'jama', name: 'JAMA', group: 'Journal', colors: ['#374E55', '#DF8F44', '#00A1D5', '#B24745', '#79AF97', '#6A6599', '#80796B'] },
    // --- colorblind-safe ---
    { id: 'okabe', name: 'Okabe–Ito', group: 'Colorblind-safe', cb: true, colors: ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#000000'] },
    { id: 'tolBright', name: 'Tol Bright', group: 'Colorblind-safe', cb: true, colors: ['#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377', '#BBBBBB'] },
    { id: 'tolMuted', name: 'Tol Muted', group: 'Colorblind-safe', cb: true, colors: ['#CC6677', '#332288', '#DDCC77', '#117733', '#88CCEE', '#882255', '#44AA99', '#999933', '#AA4499'] },
    { id: 'tolVibrant', name: 'Tol Vibrant', group: 'Colorblind-safe', cb: true, colors: ['#EE7733', '#0077BB', '#33BBEE', '#EE3377', '#CC3311', '#009988', '#BBBBBB'] },
    { id: 'tableauCB', name: 'Tableau Colorblind', group: 'Colorblind-safe', cb: true, colors: ['#1170AA', '#FC7D0B', '#A3ACB9', '#57606C', '#5FA2CE', '#C85200', '#7B848F', '#A3CCE9', '#FFBC79', '#C8D0D9'] },
    { id: 'ibm', name: 'IBM', group: 'Colorblind-safe', cb: true, colors: ['#648FFF', '#785EF0', '#DC267F', '#FE6100', '#FFB000'] },
    // --- perceptual (matplotlib), sampled to discrete swatches ---
    { id: 'viridis', name: 'Viridis', group: 'Perceptual', cb: true, colors: ['#440154', '#46327E', '#365C8D', '#277F8E', '#1FA187', '#4AC16D', '#A0DA39', '#FDE725'] },
    { id: 'cividis', name: 'Cividis', group: 'Perceptual', cb: true, colors: ['#00204D', '#00336F', '#4C556A', '#6C6D72', '#8A8779', '#ADA361', '#D3C164', '#FFEA46'] },
    { id: 'plasma', name: 'Plasma', group: 'Perceptual', cb: true, colors: ['#0D0887', '#5402A3', '#8B0AA5', '#B93289', '#DB5C68', '#F48849', '#FEBC2A', '#F0F921'] },
    { id: 'magma', name: 'Magma', group: 'Perceptual', cb: true, colors: ['#000004', '#221150', '#5F187F', '#982D80', '#D3436E', '#F1605D', '#FE9F6D', '#FCFDBF'] },
    { id: 'inferno', name: 'Inferno', group: 'Perceptual', cb: true, colors: ['#000004', '#280B54', '#65156E', '#9F2A63', '#D44842', '#F57D15', '#FAC127', '#FCFFA4'] },
    // --- single-hue / mono ---
    { id: 'blues', name: 'Blues', group: 'Single-hue', cb: true, colors: ['#08306B', '#08519C', '#2171B5', '#4292C6', '#6BAED6', '#9ECAE1', '#C6DBEF'] },
    { id: 'greens', name: 'Greens', group: 'Single-hue', cb: true, colors: ['#00441B', '#006D2C', '#238B45', '#41AB5D', '#74C476', '#A1D99B', '#C7E9C0'] },
    { id: 'grayscale', name: 'Grayscale', group: 'Single-hue', cb: true, colors: ['#1A1A1A', '#4D4D4D', '#737373', '#969696', '#B3B3B3', '#CCCCCC'] },
  ];
  function paletteById(id) { return PALETTES.find((p) => p.id === id) || null; }
  // Expand a palette's colors to exactly n entries by cycling — keeps per-item color
  // swatches aligned 1:1 with groups even when there are more groups than base colors.
  function expandPalette(colors, n) { const out = []; for (let i = 0; i < n; i++) out.push(colors[i % colors.length]); return out; }

  // ---- point markers (per-series symbol shapes) ----
  // Shape ids used by the figure "Point symbols" control.
  const MARKERS = [['circle', '● Circle'], ['square', '■ Square'], ['triangle', '▲ Triangle'], ['diamond', '◆ Diamond'], ['cross', '✕ Cross']];
  // SVG for one data-point marker centered at (cx,cy), sized to roughly match a
  // radius-r circle. opt: {fill, stroke, fillOpacity, strokeWidth, attrs}. `attrs` is
  // extra markup injected on the element (class + data-* so the app can hit-test the
  // point for per-point editing). The open "cross" (×) has no fill and is stroked in
  // the marker's fill color so it reads on any background.
  function markerSVG(cx, cy, r, shape, opt) {
    opt = opt || {};
    const fill = opt.fill || '#1c2733';
    const stroke = opt.stroke || fill;
    const fo = opt.fillOpacity != null ? opt.fillOpacity : 1;
    const sw = opt.strokeWidth != null ? opt.strokeWidth : 0.8;
    const x = opt.attrs ? ' ' + opt.attrs : '';
    // Overall element opacity (fill + stroke together) — used to fade points that
    // sit on top of an error bar so the whisker reads through (issue #17).
    const op = opt.opacity != null ? ` opacity="${opt.opacity}"` : '';
    const common = `fill-opacity="${fo}" stroke="${stroke}" stroke-width="${sw}"${op}`;
    switch (shape) {
      case 'square': { const s = r * 1.78; return `<rect x="${(cx - s / 2).toFixed(2)}" y="${(cy - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="${fill}" ${common}${x}/>`; }
      case 'triangle': { const h = r * 2.0; const p = `${cx.toFixed(2)},${(cy - h * 0.6).toFixed(2)} ${(cx - h * 0.55).toFixed(2)},${(cy + h * 0.4).toFixed(2)} ${(cx + h * 0.55).toFixed(2)},${(cy + h * 0.4).toFixed(2)}`; return `<polygon points="${p}" fill="${fill}" ${common}${x}/>`; }
      case 'diamond': { const d = r * 1.48; return `<polygon points="${cx.toFixed(2)},${(cy - d).toFixed(2)} ${(cx + d).toFixed(2)},${cy.toFixed(2)} ${cx.toFixed(2)},${(cy + d).toFixed(2)} ${(cx - d).toFixed(2)},${cy.toFixed(2)}" fill="${fill}" ${common}${x}/>`; }
      case 'cross': { const a = r * 1.2; return `<path d="M${(cx - a).toFixed(2)} ${(cy - a).toFixed(2)} L${(cx + a).toFixed(2)} ${(cy + a).toFixed(2)} M${(cx + a).toFixed(2)} ${(cy - a).toFixed(2)} L${(cx - a).toFixed(2)} ${(cy + a).toFixed(2)}" fill="none" stroke="${fill}" stroke-width="${Math.max(sw, 1.7).toFixed(2)}" stroke-linecap="round"${x}/>`; }
      default: return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${fill}" ${common}${x}/>`;
    }
  }
  // Per-point symbol resolution + hit-test metadata. A point is identified by
  // "group:index"; opts.pointMarkers[key] (set by double-click) overrides the series
  // default. ptAttrs stamps the class + coordinates the app reads to locate a point.
  function ptShape(opts, g, vi, seriesShape) {
    const pm = opts.pointMarkers; const k = g + ':' + vi;
    return (pm && pm[k]) || seriesShape || 'circle';
  }
  function ptAttrs(g, vi, px, py) {
    return `class="data-point" data-pg="${g}" data-pi="${vi}" data-px="${px.toFixed(2)}" data-py="${py.toFixed(2)}"`;
  }
  // Does a data point (center px,py, radius r) overlap an error bar closely enough
  // that drawing it opaque would hide the whisker? eb = { x, y0, y1, caps:[y…], capW }
  // where y0..y1 is the vertical stem span and caps are the cap y-positions.
  // Overlapping points are faded so the bar reads through them (issue #17).
  function overlapsErrorBar(px, py, r, eb) {
    if (!eb) return false;
    const pad = r + 1.2;                                  // point radius + ~half the whisker stroke
    if (Math.abs(px - eb.x) <= pad && py >= eb.y0 - pad && py <= eb.y1 + pad) return true;
    for (let k = 0; k < eb.caps.length; k++) {
      if (Math.abs(py - eb.caps[k]) <= pad && Math.abs(px - eb.x) <= eb.capW + r) return true;
    }
    return false;
  }

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
  const escAttr = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // most-frequent value(s); null when every value is unique (no meaningful mode)
  function modeOf(a) {
    const counts = new Map();
    a.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let bestC = 0; counts.forEach((c) => { if (c > bestC) bestC = c; });
    if (bestC <= 1) return null;
    const modes = []; counts.forEach((c, v) => { if (c === bestC) modes.push(v); });
    return modes.sort((x, y) => x - y);
  }

  // ---- shared frame ----
  function frame(opts) {
    const W = opts.width || 580, H = opts.height || 420;
    const m = Object.assign({ top: 46, right: 24, bottom: 64, left: 70 }, opts.margin || {});
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    return { W, H, m, pw, ph, x0: m.left, x1: m.left + pw, y0: m.top, y1: m.top + ph };
  }
  function open(f, title, ts) {
    ts = ts || textStyleOf(null);
    return `<svg viewBox="0 0 ${f.W} ${f.H}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" style="background:#fff">` +
      `<rect x="0" y="0" width="${f.W}" height="${f.H}" fill="#ffffff"/>` +
      (title ? `<text x="${f.W / 2}" y="26" text-anchor="middle" font-size="${ts.titleSize}" font-weight="${ts.titleWeight}" fill="#1c2733">${esc(title)}</text>` : '');
  }
  function yAxis(f, sc, label, ts) {
    ts = ts || textStyleOf(null);
    let s = `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x0}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    sc.ticks.forEach((t) => {
      const y = sc.toY(t);
      if (y < f.y0 - 0.5 || y > f.y1 + 0.5) return;
      s += `<line x1="${f.x0 - 5}" y1="${y}" x2="${f.x0}" y2="${y}" stroke="#1c2733" stroke-width="1.1"/>`;
      s += `<text x="${f.x0 - 9}" y="${y + 4}" text-anchor="end" font-size="${ts.tickSize}" fill="#5b6b7b">${(sc.fmt || fmt)(t)}</text>`;
    });
    if (label) s += `<text transform="translate(${18},${(f.y0 + f.y1) / 2}) rotate(-90)" text-anchor="middle" font-size="${ts.labelSize}" font-weight="${ts.labelWeight}" fill="#1c2733">${esc(label)}</text>`;
    return s;
  }
  // ---- axis scaling: linear/log, auto or custom range, plain/scientific labels ----
  let _uid = 0;
  function mkFmt(axis) {
    if (axis && axis.sci) return (v) => (v === 0 ? '0' : (+v).toExponential(1));
    return fmt;
  }
  function niceCustom(min, max, nticks) {
    const step = niceNum((max - min) / ((nticks || 6) - 1), true) || 1;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 0.5; v += step) ticks.push(+v.toPrecision(12));
    if (!ticks.length) ticks.push(min, max);
    return ticks;
  }
  // ticks at a user-specified interval across [min,max]; returns [] when the step is
  // unusable (non-positive, or so fine it would yield an absurd number of ticks) so
  // callers can fall back to the automatic ticks.
  function ticksByStep(min, max, step) {
    if (!(step > 0) || !isFinite(min) || !isFinite(max) || !(max > min)) return [];
    if ((max - min) / step > 1000) return [];
    const ticks = [], eps = step * 1e-6;
    for (let v = Math.ceil((min - eps) / step) * step; v <= max + eps; v += step) ticks.push(+v.toPrecision(12));
    return ticks;
  }
  // axis: {auto,min,max,log,sci,step}. Returns {ticks,min,max,log,fmt(v),frac(v)}. frac maps value → 0..1.
  function axisScale(dataLo, dataHi, axis, nticks) {
    axis = axis || {}; nticks = nticks || 6;
    const cMin = (axis.auto === false && axis.min !== '' && axis.min != null && isFinite(+axis.min)) ? +axis.min : null;
    const cMax = (axis.auto === false && axis.max !== '' && axis.max != null && isFinite(+axis.max)) ? +axis.max : null;
    // custom tick interval applies to linear axes whether the range is auto or fixed
    const cStep = (axis.step !== '' && axis.step != null && isFinite(+axis.step) && +axis.step > 0) ? +axis.step : null;
    if (axis.log) {
      const hi = cMax != null ? cMax : dataHi;
      let lo = cMin != null ? cMin : dataLo;
      if (hi > 0) {
        if (!(lo > 0)) lo = hi / 1000;
        const e0 = Math.floor(Math.log10(lo)), e1 = Math.max(e0 + 1, Math.ceil(Math.log10(hi)));
        const min = Math.pow(10, e0), max = Math.pow(10, e1), lmin = Math.log10(min), lmax = Math.log10(max);
        const ticks = []; for (let e = e0; e <= e1; e++) ticks.push(Math.pow(10, e));
        return { ticks, min, max, log: true, fmt: mkFmt(axis), frac: (v) => (Math.log10(v) - lmin) / (lmax - lmin) };
      }
      // no positive data → fall through to linear (builder flags this)
    }
    let min, max, ticks;
    if (cMin != null || cMax != null) {
      min = cMin != null ? cMin : dataLo; max = cMax != null ? cMax : dataHi;
      if (!(max > min)) { const nt = niceTicks(dataLo, dataHi, nticks); min = nt.min; max = nt.max; ticks = nt.ticks; }
      else ticks = niceCustom(min, max, nticks);
    } else { const nt = niceTicks(dataLo, dataHi, nticks); min = nt.min; max = nt.max; ticks = nt.ticks; }
    if (cStep) { const stepped = ticksByStep(min, max, cStep); if (stepped.length) ticks = stepped; }
    return { ticks, min, max, log: false, fmt: mkFmt(axis), frac: (v) => (v - min) / (max - min) };
  }
  function makeYScale(f, lo, hi, nticks, axis) {
    const sc = axisScale(lo, hi, axis, nticks || 6);
    sc.toY = (v) => f.y1 - sc.frac(v) * f.ph;
    return sc;
  }
  function baseVal(sc) { return sc.log ? sc.min : Math.max(0, sc.min); } // bar/area baseline

  // ---- clip plot area + out-of-range notice ----
  function clipWrap(f, uid, marks) {
    return `<clipPath id="pc_${uid}"><rect x="${f.x0}" y="${f.y0}" width="${f.pw}" height="${f.ph}"/></clipPath>` +
      `<g clip-path="url(#pc_${uid})">${marks}</g>`;
  }
  function tally(vals, sc, t) { vals.forEach((v) => { if (sc.log && !(v > 0)) t.log++; else if (v < sc.min - 1e-9 || v > sc.max + 1e-9) t.out++; }); }
  function noticeSVG(f, t) {
    const lines = [];
    if (t.logFail) lines.push('⚠ Log axis needs positive data — showing linear');
    if (t.log) lines.push(`⚠ ${t.log} non-positive value${t.log > 1 ? 's' : ''} omitted (log axis)`);
    if (t.out) lines.push(`⚠ ${t.out} value${t.out > 1 ? 's' : ''} outside axis range not shown`);
    return lines.map((tx, i) => `<text x="${f.x0}" y="${f.H - 8 - (lines.length - 1 - i) * 13}" font-size="10.5" fill="#b45309">${esc(tx)}</text>`).join('');
  }
  // transparent per-category drag handles / drop targets (categorical charts).
  // tips[i], when given, adds hover-tooltip data-* attributes to that category's rect.
  function catHits(f, n, tips) {
    const slot = f.pw / n; let s = '';
    for (let i = 0; i < n; i++) s += `<rect class="cat-hit" data-i="${i}"${(tips && tips[i]) ? ' ' + tips[i] : ''} x="${f.x0 + slot * i}" y="${f.y0}" width="${slot}" height="${f.ph}" fill="transparent" style="cursor:grab"/>`;
    return s;
  }
  // per-bar hover stats (mean/median/mode/range) encoded as data-* attributes read by the app
  function statTip(name, values) {
    const s = values.slice().sort((a, b) => a - b);
    const md = modeOf(values);
    const modeStr = md == null ? '—' : md.map(fmt).join(', ');
    return `data-tip="1" data-name="${escAttr(name)}" data-n="${values.length}"` +
      ` data-mean="${fmt(mean(values))}" data-median="${fmt(quantile(s, 0.5))}"` +
      ` data-mode="${escAttr(modeStr)}" data-range="${fmt(s[0])} – ${fmt(s[s.length - 1])}"`;
  }

  // resolve significance-bracket appearance from opts.sigStyle, with back-compatible defaults
  function sigStyleOf(opts) {
    const st = (opts && opts.sigStyle) || {};
    return {
      notation: st.notation || 'stars',                                                  // 'stars' | 'pvalue' | 'psummary'
      color: st.color || '#1c2733',
      fontSize: st.fontSize != null && isFinite(+st.fontSize) ? +st.fontSize : 12.5,
      bold: st.bold !== false,
      showLine: st.showLine !== false,
      lineWidth: st.lineWidth != null && isFinite(+st.lineWidth) ? +st.lineWidth : 1.2,
    };
  }
  // resolve title / axis-label / tick-number font appearance from opts.fontStyle (issue #16).
  // Back-compatible: with no fontStyle set (older or freshly-loaded figures) this returns the
  // original hardcoded sizes/weights, so existing figures render pixel-identically. One "label
  // size" scales axis titles, category names and tick numbers together, but category text and
  // (especially) numeric ticks stay progressively smaller and are damped/capped so a large
  // label size enlarges the headings without crowding the plot with oversized numbers.
  function textStyleOf(opts) {
    const st = (opts && opts.fontStyle) || {};
    let titleSize = st.titleSize != null && isFinite(+st.titleSize) ? +st.titleSize : 15.5;
    let labelSize = st.labelSize != null && isFinite(+st.labelSize) ? +st.labelSize : 12.5;
    titleSize = Math.min(40, Math.max(8, titleSize));
    labelSize = Math.min(22, Math.max(7, labelSize));
    const bold = st.bold !== false;                                  // default bold → title 650 / axis 600 as before
    const catSize = Math.max(7, labelSize - 0.5);                    // category / group names sit just under the axis title
    const tickSize = Math.max(7, Math.min(labelSize - 0.5, 11.5 + (labelSize - 12.5) * 0.6)); // numeric ticks: damped so they never dominate
    return { titleSize, labelSize, catSize, tickSize, titleWeight: bold ? 650 : 400, labelWeight: bold ? 600 : 400, bold };
  }
  // label for one bracket from its p-value per the chosen notation; falls back to a
  // pre-stored label (figures saved before p-values were retained) when p is absent.
  function sigLabel(b, notation) {
    const p = b.p;
    if (p == null || isNaN(p)) return b.label != null ? String(b.label) : '';
    if (notation === 'pvalue') return p < 0.0001 ? 'P < 0.0001' : p > 0.9999 ? 'P > 0.9999' : 'P = ' + (+p.toFixed(4));
    if (notation === 'psummary') return p < 0.0001 ? 'P < 0.0001' : p < 0.001 ? 'P < 0.001' : p < 0.01 ? 'P < 0.01' : p < 0.05 ? 'P < 0.05' : 'ns';
    return p < 0.0001 ? '****' : p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : 'ns';
  }

  // significance brackets above plot. sig:[{i,j,label,p?,on?}] referencing x-centers cx[].
  // Entries with on===false are hidden (the graph's "Comparisons shown" list toggles them).
  function sigBrackets(f, cx, topAt, sig, style) {
    const shown = (sig || []).filter((b) => b.on !== false);
    if (!shown.length) return '';
    const st = style || sigStyleOf(null);
    const weight = st.bold ? 600 : 400;
    const h = 6, gap = st.fontSize + 9.5;   // stack spacing tracks text size (22 at the default)
    let s = '', level = 0;
    const baseY = Math.min(...topAt) - 14;
    shown.forEach((b) => {
      const x1 = cx[b.i], x2 = cx[b.j];
      if (x1 == null || x2 == null) return;
      const y = baseY - level * gap;
      if (st.showLine) s += `<path d="M${x1} ${y} L${x1} ${y - h} L${x2} ${y - h} L${x2} ${y}" fill="none" stroke="${st.color}" stroke-width="${st.lineWidth}"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${y - h - 4}" text-anchor="middle" font-size="${st.fontSize}" font-weight="${weight}" fill="${st.color}">${esc(sigLabel(b, st.notation))}</text>`;
      level++;
    });
    return s;
  }

  // Width of a categorical mark (bar / box / point cloud) within its per-category
  // slot. When opts.barWidth is set it is an explicit fraction of the slot (clamped
  // to 0.05–1) so users can tighten or spread the categories along the x-axis;
  // unset falls back to the legacy cap-based sizing so existing figures are
  // unchanged. See issue #15 (adjustable bar/column width & spacing).
  function slotWidth(opts, slot, mult, cap) {
    const bw = opts && opts.barWidth;
    if (bw != null && isFinite(+bw) && +bw > 0) return slot * Math.min(1, Math.max(0.05, +bw));
    return Math.min(cap, slot * mult);
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
    const yAx = opts.yAxis || {};
    const hi = Math.max(...stats.map((s) => s.m + s.err), ...groups.flatMap((g) => opts.showPoints ? g.values : []));
    const dmin = Math.min(0, ...stats.map((s) => s.m - s.err), ...groups.flatMap((g) => opts.showPoints ? g.values : []));
    const sc = makeYScale(f, dmin, hi * 1.08, 6, yAx);
    const uid = ++_uid;
    const n = groups.length;
    const slot = f.pw / n, bw = slotWidth(opts, slot, 0.6, 58);
    const barFill = opts.showPoints ? 0.5 : 0.82;   // dim the bar when points overlay it so they read clearly
    const ts = textStyleOf(opts);
    let s = open(f, opts.title, ts);
    // zero line / y axis
    s += yAxis(f, sc, opts.yLabel || 'Value', ts);
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    const cx = [], tops = [];
    const t = { log: 0, out: 0, logFail: yAx.log && !sc.log };
    let marks = '';
    stats.forEach((st, i) => {
      const x = f.x0 + slot * i + slot / 2;
      cx.push(x);
      const yTop = sc.toY(st.m), yBase = sc.toY(baseVal(sc));
      const col = colors[i % colors.length];
      marks += `<rect x="${x - bw / 2}" y="${Math.min(yTop, yBase)}" width="${bw}" height="${Math.abs(yBase - yTop)}" fill="${col}" fill-opacity="${barFill}" stroke="${col}" stroke-width="1.2" rx="1.5"/>`;
      // error bar
      let ebar = null;
      if (st.err > 0) {
        const yhi = sc.toY(st.m + st.err), ylo = sc.toY(st.m - st.err);
        const both = opts.errorBothSides !== false;
        const stemEnd = both ? ylo : (st.m >= 0 ? yTop : ylo);
        marks += `<line x1="${x}" y1="${yhi}" x2="${x}" y2="${st.m >= 0 ? yTop : ylo}" stroke="#1c2733" stroke-width="1.3"/>`;
        marks += `<line x1="${x - 7}" y1="${yhi}" x2="${x + 7}" y2="${yhi}" stroke="#1c2733" stroke-width="1.3"/>`;
        if (both) { marks += `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${ylo}" stroke="#1c2733" stroke-width="1.3"/>`; marks += `<line x1="${x - 7}" y1="${ylo}" x2="${x + 7}" y2="${ylo}" stroke="#1c2733" stroke-width="1.3"/>`; }
        // geometry so overlapping points can be faded to reveal the whisker (issue #17)
        ebar = { x, y0: Math.min(yhi, stemEnd), y1: Math.max(yhi, stemEnd), caps: both ? [yhi, ylo] : [yhi], capW: 7 };
        tops.push(yhi);
      } else tops.push(yTop);
      // points
      if (opts.showPoints) {
        const seriesShape = (opts.markers && opts.markers[i]) || 'circle';
        let seed = i * 99 + 7;
        st.values.forEach((v, vi) => { seed = (seed * 9301 + 49297) % 233280; const j = (seed / 233280 - 0.5) * bw * 0.7; const px = x + j, py = sc.toY(v); const dim = overlapsErrorBar(px, py, 3.1, ebar); marks += markerSVG(px, py, 3.1, ptShape(opts, i, vi, seriesShape), { fill: '#1c2733', stroke: '#ffffff', fillOpacity: 0.9, strokeWidth: 0.8, opacity: dim ? 0.32 : 1, attrs: ptAttrs(i, vi, px, py) }); });
      }
      // x label (outside clip)
      s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="${ts.catSize}" fill="#1c2733">${esc(st.name)}</text>`;
      tally(opts.showPoints ? st.values : [st.m], sc, t);
    });
    s += clipWrap(f, uid, marks);
    s += sigBrackets(f, cx, tops, opts.sig, sigStyleOf(opts));
    s += errLegend(f, errType);
    s += noticeSVG(f, t);
    s += catHits(f, n, stats.map((st) => statTip(st.name, st.values)));
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
    const yAx = opts.yAxis || {};
    const all = groups.flatMap((g) => g.values);
    const sc = makeYScale(f, Math.min(...all), Math.max(...all), 6, yAx);
    const uid = ++_uid;
    const n = groups.length, slot = f.pw / n;
    const spread = slotWidth(opts, slot, 0.5, 46);                 // horizontal extent of the jittered point cloud
    const customW = opts.barWidth != null && isFinite(+opts.barWidth) && +opts.barWidth > 0;
    const wm = customW ? Math.max(12, spread / 2) : 22;            // mean/median bar half-width brackets the cloud
    const ts = textStyleOf(opts);
    let s = open(f, opts.title, ts);
    s += yAxis(f, sc, opts.yLabel || 'Value', ts);
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    const cx = [], tops = [];
    const t = { log: 0, out: 0, logFail: yAx.log && !sc.log };
    let marks = '';
    groups.forEach((g, i) => {
      const x = f.x0 + slot * i + slot / 2; cx.push(x);
      const col = colors[i % colors.length];
      const m = mean(g.values), se = sem(g.values), sdv = sd(g.values);
      const err = errType === 'sem' ? se : errType === 'ci95' ? tcrit95(g.values.length - 1) * se : sdv;
      const seriesShape = (opts.markers && opts.markers[i]) || 'circle';
      let seed = i * 131 + 17;
      g.values.forEach((v, vi) => { seed = (seed * 9301 + 49297) % 233280; const j = (seed / 233280 - 0.5) * spread; const px = x + j, py = sc.toY(v); marks += markerSVG(px, py, 3.6, ptShape(opts, i, vi, seriesShape), { fill: col, stroke: col, fillOpacity: 0.78, strokeWidth: 0.8, attrs: ptAttrs(i, vi, px, py) }); });
      // mean line + error
      marks += `<line x1="${x - wm}" y1="${sc.toY(m)}" x2="${x + wm}" y2="${sc.toY(m)}" stroke="#1c2733" stroke-width="2"/>`;
      if (errType !== 'none') {
        marks += `<line x1="${x}" y1="${sc.toY(m - err)}" x2="${x}" y2="${sc.toY(m + err)}" stroke="#1c2733" stroke-width="1.3"/>`;
        marks += `<line x1="${x - 8}" y1="${sc.toY(m + err)}" x2="${x + 8}" y2="${sc.toY(m + err)}" stroke="#1c2733" stroke-width="1.3"/>`;
        marks += `<line x1="${x - 8}" y1="${sc.toY(m - err)}" x2="${x + 8}" y2="${sc.toY(m - err)}" stroke="#1c2733" stroke-width="1.3"/>`;
        tops.push(sc.toY(m + err));
      } else tops.push(sc.toY(Math.max(...g.values)));
      s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="${ts.catSize}" fill="#1c2733">${esc(g.name)}</text>`;
      tally(g.values, sc, t);
    });
    s += clipWrap(f, uid, marks);
    s += sigBrackets(f, cx, tops, opts.sig, sigStyleOf(opts));
    s += errLegend(f, errType);
    s += noticeSVG(f, t);
    s += catHits(f, n);
    s += '</svg>';
    return s;
  }

  // ---- 3. box-and-whisker ----
  function boxPlot(groups, opts = {}) {
    const f = frame(opts);
    const colors = opts.colors || PALETTE;
    const yAx = opts.yAxis || {};
    const all = groups.flatMap((g) => g.values);
    const sc = makeYScale(f, Math.min(...all), Math.max(...all), 6, yAx);
    const uid = ++_uid;
    const n = groups.length, slot = f.pw / n, bw = slotWidth(opts, slot, 0.5, 48);
    const ts = textStyleOf(opts);
    let s = open(f, opts.title, ts);
    s += yAxis(f, sc, opts.yLabel || 'Value', ts);
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    const cx = [], tops = [];
    const t = { log: 0, out: 0, logFail: yAx.log && !sc.log };
    let marks = '';
    groups.forEach((g, i) => {
      const x = f.x0 + slot * i + slot / 2; cx.push(x);
      const col = colors[i % colors.length];
      const sorted = g.values.slice().sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25), med = quantile(sorted, 0.5), q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      const lowF = q1 - 1.5 * iqr, highF = q3 + 1.5 * iqr;
      const inl = sorted.filter((v) => v >= lowF && v <= highF);
      const wlo = Math.min(...inl), whi = Math.max(...inl);
      marks += `<rect x="${x - bw / 2}" y="${sc.toY(q3)}" width="${bw}" height="${sc.toY(q1) - sc.toY(q3)}" fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-width="1.5"/>`;
      marks += `<line x1="${x - bw / 2}" y1="${sc.toY(med)}" x2="${x + bw / 2}" y2="${sc.toY(med)}" stroke="${col}" stroke-width="2.2"/>`;
      marks += `<line x1="${x}" y1="${sc.toY(q3)}" x2="${x}" y2="${sc.toY(whi)}" stroke="${col}" stroke-width="1.3"/>`;
      marks += `<line x1="${x}" y1="${sc.toY(q1)}" x2="${x}" y2="${sc.toY(wlo)}" stroke="${col}" stroke-width="1.3"/>`;
      marks += `<line x1="${x - bw / 4}" y1="${sc.toY(whi)}" x2="${x + bw / 4}" y2="${sc.toY(whi)}" stroke="${col}" stroke-width="1.3"/>`;
      marks += `<line x1="${x - bw / 4}" y1="${sc.toY(wlo)}" x2="${x + bw / 4}" y2="${sc.toY(wlo)}" stroke="${col}" stroke-width="1.3"/>`;
      sorted.filter((v) => v < lowF || v > highF).forEach((v) => { marks += `<circle cx="${x}" cy="${sc.toY(v)}" r="3" fill="none" stroke="${col}" stroke-width="1.2"/>`; });
      tops.push(sc.toY(whi));
      s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="${ts.catSize}" fill="#1c2733">${esc(g.name)}</text>`;
      tally(g.values, sc, t);
    });
    s += clipWrap(f, uid, marks);
    s += sigBrackets(f, cx, tops, opts.sig, sigStyleOf(opts));
    s += `<text x="${f.x1}" y="${f.H - 8}" text-anchor="end" font-size="10.5" fill="#8696a7">box: median &amp; IQR · whiskers: 1.5×IQR</text>`;
    s += noticeSVG(f, t);
    s += catHits(f, n);
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
    const ts = textStyleOf(opts);
    let s = open(f, opts.title, ts);
    s += yAxis(f, sc, opts.yLabel || 'Value', ts);
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    pairs.forEach(([a, b]) => {
      const up = b >= a;
      s += `<line x1="${xA}" y1="${sc.toY(a)}" x2="${xB}" y2="${sc.toY(b)}" stroke="${up ? '#dc2626' : '#2563eb'}" stroke-width="1.1" stroke-opacity="0.55"/>`;
      s += `<circle cx="${xA}" cy="${sc.toY(a)}" r="3.6" fill="#0d9488"/>`;
      s += `<circle cx="${xB}" cy="${sc.toY(b)}" r="3.6" fill="#7c3aed"/>`;
    });
    s += `<text x="${xA}" y="${f.y1 + 18}" text-anchor="middle" font-size="${ts.labelSize}" font-weight="${ts.labelWeight}" fill="#1c2733">${esc(opts.labelA || 'Before')}</text>`;
    s += `<text x="${xB}" y="${f.y1 + 18}" text-anchor="middle" font-size="${ts.labelSize}" font-weight="${ts.labelWeight}" fill="#1c2733">${esc(opts.labelB || 'After')}</text>`;
    s += '</svg>';
    return s;
  }

  // ---- 5. XY scatter + regression ----
  function xyPlot(xs, ys, opts = {}) {
    const f = frame(opts);
    const yAx = opts.yAxis || {}, xAx = opts.xAxis || {};
    const sc = makeYScale(f, Math.min(...ys), Math.max(...ys), 6, yAx);
    const scx = (() => { const a = axisScale(Math.min(...xs), Math.max(...xs), xAx, 6); a.toX = (v) => f.x0 + a.frac(v) * f.pw; return a; })();
    const uid = ++_uid;
    const ts = textStyleOf(opts);
    let s = open(f, opts.title, ts);
    s += yAxis(f, sc, opts.yLabel || 'Y', ts);
    // x axis
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    scx.ticks.forEach((tk) => { const x = scx.toX(tk); if (x < f.x0 - 0.5 || x > f.x1 + 0.5) return; s += `<line x1="${x}" y1="${f.y1}" x2="${x}" y2="${f.y1 + 5}" stroke="#1c2733" stroke-width="1.1"/>`; s += `<text x="${x}" y="${f.y1 + 19}" text-anchor="middle" font-size="${ts.tickSize}" fill="#5b6b7b">${scx.fmt(tk)}</text>`; });
    s += `<text x="${(f.x0 + f.x1) / 2}" y="${f.H - 14}" text-anchor="middle" font-size="${ts.labelSize}" font-weight="${ts.labelWeight}" fill="#1c2733">${esc(opts.xLabel || 'X')}</text>`;
    let marks = '';
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
      let up = `M${band[0].x} ${band[0].yhi}`;
      band.forEach((p) => { up += ` L${p.x} ${p.yhi}`; });
      for (let k = band.length - 1; k >= 0; k--) up += ` L${band[k].x} ${band[k].ylo}`;
      marks += `<path d="${up} Z" fill="#0d9488" fill-opacity="0.12"/>`;
      marks += `<line x1="${band[0].x}" y1="${band[0].y}" x2="${band[N].x}" y2="${band[N].y}" stroke="#0d9488" stroke-width="2"/>`;
    }
    // points
    const ptFill = opts.pointColor || '#2563eb', ptStroke = opts.pointColor || '#1d4ed8';
    const seriesShape = opts.marker || 'circle';
    const t = { log: 0, out: 0, logFail: (xAx.log && !scx.log) || (yAx.log && !sc.log) };
    for (let i = 0; i < xs.length; i++) {
      if ((scx.log && !(xs[i] > 0)) || (sc.log && !(ys[i] > 0))) { t.log++; continue; }
      if (xs[i] < scx.min - 1e-9 || xs[i] > scx.max + 1e-9 || ys[i] < sc.min - 1e-9 || ys[i] > sc.max + 1e-9) t.out++;
      const px = scx.toX(xs[i]), py = sc.toY(ys[i]);
      marks += markerSVG(px, py, 3.8, ptShape(opts, 0, i, seriesShape), { fill: ptFill, stroke: ptStroke, fillOpacity: 0.75, strokeWidth: 0.8, attrs: ptAttrs(0, i, px, py) });
    }
    s += clipWrap(f, uid, marks);
    if (opts.annotation) s += `<text x="${f.x0 + 10}" y="${f.y0 + 14}" font-size="11.5" fill="#5b6b7b">${esc(opts.annotation)}</text>`;
    s += noticeSVG(f, t);
    s += '</svg>';
    return s;
  }

  // ---- 6. Kaplan-Meier survival ----
  function survivalPlot(curves, opts = {}) {
    // curves: [{name, steps:[{time,S,lo,hi,censorOnly}], censorTimes:[], color}]
    const f = frame(Object.assign({ margin: { top: 46, right: 24, bottom: 92, left: 66 } }, opts));
    const colors = opts.colors || PALETTE;
    const maxT = Math.max(...curves.flatMap((c) => c.steps.map((s) => s.time)), 1);
    const xAx = Object.assign({}, opts.xAxis, { log: false }); // time axis: range + notation, no log
    const scx = (() => { const a = axisScale(0, maxT, xAx, 6); a.toX = (v) => f.x0 + a.frac(v) * f.pw; return a; })();
    const toY = (sv) => f.y1 - sv * f.ph;
    const uid = ++_uid;
    const ts = textStyleOf(opts);
    let s = open(f, opts.title, ts);
    // y axis 0..1
    s += `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x0}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    for (let p = 0; p <= 1.0001; p += 0.25) { const y = toY(p); s += `<line x1="${f.x0 - 5}" y1="${y}" x2="${f.x0}" y2="${y}" stroke="#1c2733" stroke-width="1.1"/>`; s += `<text x="${f.x0 - 9}" y="${y + 4}" text-anchor="end" font-size="${ts.tickSize}" fill="#5b6b7b">${opts.percent ? p * 100 : p.toFixed(2)}</text>`; }
    s += `<text transform="translate(16,${(f.y0 + f.y1) / 2}) rotate(-90)" text-anchor="middle" font-size="${ts.labelSize}" font-weight="${ts.labelWeight}" fill="#1c2733">${esc(opts.yLabel || (opts.percent ? 'Percent survival' : 'Survival probability'))}</text>`;
    // x axis
    s += `<line x1="${f.x0}" y1="${f.y1}" x2="${f.x1}" y2="${f.y1}" stroke="#1c2733" stroke-width="1.3"/>`;
    scx.ticks.forEach((t) => { const x = scx.toX(t); if (x < f.x0 - 0.5 || x > f.x1 + 0.5) return; s += `<line x1="${x}" y1="${f.y1}" x2="${x}" y2="${f.y1 + 5}" stroke="#1c2733" stroke-width="1.1"/>`; s += `<text x="${x}" y="${f.y1 + 18}" text-anchor="middle" font-size="${ts.tickSize}" fill="#5b6b7b">${scx.fmt(t)}</text>`; });
    s += `<text x="${(f.x0 + f.x1) / 2}" y="${f.y1 + 40}" text-anchor="middle" font-size="${ts.labelSize}" font-weight="${ts.labelWeight}" fill="#1c2733">${esc(opts.xLabel || 'Time')}</text>`;
    // curves (clipped to plot area)
    let cmarks = '';
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
        let plo = 1, phi = 1, px = scx.toX(0);
        const up = [], dn = [];
        up.push([px, toY(1)]); dn.push([px, toY(1)]);
        c.steps.forEach((st) => { const x = scx.toX(st.time); up.push([x, toY(phi)]); dn.push([x, toY(plo)]); phi = st.hi != null ? st.hi : st.S; plo = st.lo != null ? st.lo : st.S; up.push([x, toY(phi)]); dn.push([x, toY(plo)]); });
        up.push([scx.toX(scx.max), toY(phi)]); dn.push([scx.toX(scx.max), toY(plo)]);
        let band = `M${up[0][0]} ${up[0][1]}`; up.forEach((p) => band += ` L${p[0]} ${p[1]}`); for (let k = dn.length - 1; k >= 0; k--) band += ` L${dn[k][0]} ${dn[k][1]}`;
        cmarks += `<path d="${band} Z" fill="${col}" fill-opacity="0.1"/>`;
      }
      cmarks += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
      // censor ticks
      (c.censorTimes || []).forEach((t) => { const st = lastSAt(c.steps, t); const x = scx.toX(t), y = toY(st); cmarks += `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="${col}" stroke-width="1.6"/>`; });
    });
    s += clipWrap(f, uid, cmarks);
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
    const yAx = opts.yAxis || {};
    const sc = makeYScale(f, Math.min(0, lo), hi * 1.08, 6, yAx);
    const uid = ++_uid;
    const ts = textStyleOf(opts);
    let s = open(f, opts.title, ts);
    s += yAxis(f, sc, opts.yLabel || 'Value', ts);
    s += `<line x1="${f.x0}" y1="${sc.toY(baseVal(sc))}" x2="${f.x1}" y2="${sc.toY(baseVal(sc))}" stroke="#1c2733" stroke-width="1.3"/>`;
    const slot = f.pw / a;
    const groupW = Math.min(slot * 0.82, b * 46);
    const barW = (groupW / b) * 0.8;
    const barX = []; // barX[i][j]
    const t = { log: 0, out: 0, logFail: yAx.log && !sc.log };
    let marks = '';
    for (let i = 0; i < a; i++) {
      const cx0 = f.x0 + slot * i + slot / 2; barX[i] = [];
      for (let j = 0; j < b; j++) {
        const bx = cx0 - groupW / 2 + groupW * (j + 0.5) / b;
        barX[i][j] = bx;
        const c = cs[i][j]; if (c.empty) continue;
        const col = colors[j % colors.length];
        const yTop = sc.toY(c.m), yBase = sc.toY(baseVal(sc));
        marks += `<rect x="${bx - barW / 2}" y="${Math.min(yTop, yBase)}" width="${barW}" height="${Math.abs(yBase - yTop)}" fill="${col}" fill-opacity="0.82" stroke="${col}" stroke-width="1.1" rx="1.5"/>`;
        if (c.err > 0) {
          const yhi = sc.toY(c.m + c.err), ylo = sc.toY(c.m - c.err);
          marks += `<line x1="${bx}" y1="${yhi}" x2="${bx}" y2="${ylo}" stroke="#1c2733" stroke-width="1.2"/>`;
          marks += `<line x1="${bx - 5}" y1="${yhi}" x2="${bx + 5}" y2="${yhi}" stroke="#1c2733" stroke-width="1.2"/>`;
          marks += `<line x1="${bx - 5}" y1="${ylo}" x2="${bx + 5}" y2="${ylo}" stroke="#1c2733" stroke-width="1.2"/>`;
        }
        tally([c.m], sc, t);
      }
      s += `<text x="${cx0}" y="${f.y1 + 18}" text-anchor="middle" font-size="${ts.catSize}" fill="#1c2733">${esc(rowNames[i])}</text>`;
    }
    s += clipWrap(f, uid, marks);
    // significance brackets within categories: sig=[{cat,ja,jb,label,p?}]
    const gst = sigStyleOf(opts);
    const gWeight = gst.bold ? 600 : 400;
    (opts.sig || []).filter((g) => g.on !== false).forEach((g) => {
      const row = barX[g.cat]; if (!row || row[g.ja] == null || row[g.jb] == null) return;
      const x1 = row[g.ja], x2 = row[g.jb];
      const top = Math.min(sc.toY(cs[g.cat][g.ja].m + cs[g.cat][g.ja].err), sc.toY(cs[g.cat][g.jb].m + cs[g.cat][g.jb].err)) - 12;
      if (gst.showLine) s += `<path d="M${x1} ${top} L${x1} ${top - 5} L${x2} ${top - 5} L${x2} ${top}" fill="none" stroke="${gst.color}" stroke-width="${gst.lineWidth}"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${top - 8}" text-anchor="middle" font-size="${gst.fontSize}" font-weight="${gWeight}" fill="${gst.color}">${esc(sigLabel(g, gst.notation))}</text>`;
    });
    // legend
    colNames.forEach((cn, j) => { const col = colors[j % colors.length]; const lx = f.x1 - 118, ly = f.y0 + 12 + j * 17; s += `<rect x="${lx}" y="${ly - 8}" width="12" height="12" fill="${col}" fill-opacity="0.82" stroke="${col}"/>`; s += `<text x="${lx + 18}" y="${ly + 2}" font-size="11.5" fill="#1c2733">${esc(cn)}</text>`; });
    s += errLegend(f, errType);
    s += noticeSVG(f, t);
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

  return { PALETTE, PALETTES, MARKERS, paletteById, expandPalette, markerSVG, barChart, dotPlot, boxPlot, pairedPlot, xyPlot, survivalPlot, groupedBar, svgToPNG, niceTicks, sigStyleOf, textStyleOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Charts;
