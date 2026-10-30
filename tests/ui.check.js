const assert = require('assert');
const Charts = require('../js/charts.js');
const DataLib = require('../js/data.js');

let pass = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}

// Grouped tables must retain one value per typed cell and expose the matrix shape
// consumed by both grouped chart types.
const table = new DataLib.DataTable('grouped');
table.groupNames = ['WT', 'Mutant'];
table.nsub = 2;
table.rowTitles = ['Day 0', 'Day 7'];
table.rows[0][0] = '4';
table.rows[0][1] = '5';
table.rows[0][2] = '6';
table.rows[0][3] = '7';
const matrix = table.cellsMatrix();
ok('grouped cell value is not duplicated', matrix.cells[0][0][0] === 4 && matrix.cells[0][0][1] === 5);
ok('grouped matrix preserves row and series names', matrix.rowNames[0] === 'Day 0' && matrix.colNames[1] === 'Mutant');

const cells = [
  [[1, 2, 3], [2, 3, 4]],
  [[3, 4, 5], [5, 6, 7]],
  [[6, 7, 8], [8, 9, 10]],
];
const rows = ['Day 0', 'Day 7', 'Day 14'];
const cols = ['WT', 'Mutant'];
const line = Charts.groupedLine(cells, rows, cols, { title: 'Growth', legendPosition: 'right' });
ok('grouped line chart renders a series for each group', (line.match(/class="grouped-line-series/g) || []).length === cols.length);
ok('grouped line chart includes x-axis row labels', rows.every((r) => line.includes(r)));
ok('grouped line chart includes a positioned legend', line.includes('class="chart-legend" data-position="right"'));

const grouped = Charts.groupedBar(cells, rows, cols, {
  sig: [{ ca: 0, ja: 0, cb: 1, jb: 0, p: 0.01, on: true }],
  legendPosition: 'right',
});
ok('grouped bar chart keeps legend outside the plot by default', grouped.includes('class="chart-legend" data-position="right"'));
ok('grouped bar chart labels significance annotations', grouped.includes('class="sig-annotation"'));

// Column scatters must keep near-equal replicates from burying one another when
// there is horizontal room to separate them.
function pointsOf(svg) {
  const out = [], re = /data-pg="(\d+)" data-pi="(\d+)" data-px="([-\d.]+)" data-py="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(svg))) out.push({ g: +m[1], i: +m[2], x: +m[3], y: +m[4] });
  return out;
}
function closestPair(points) {
  let best = Infinity;
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    if (points[a].g === points[b].g) best = Math.min(best, Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y));
  }
  return best;
}
// Category slots as drawn: the transparent per-category hit rects span each slot.
function slotsOf(svg) {
  return Array.from(svg.matchAll(/class="cat-hit" data-i="(\d+)"[^>]*? x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/g), (m) => ({ i: +m[1], left: +m[2], width: +m[3] }));
}
function insideSlots(svg, pts) {
  const slots = slotsOf(svg);
  return slots.length > 0 && pts.every((p) => p.x > slots[p.g].left && p.x < slots[p.g].left + slots[p.g].width);
}
// Error-bar strokes (stems and caps, 1.3 px) drawn inside the plot, as segments. The
// dot plot's 2-px mean line is not an error bar and is left out.
function whiskersOf(svg) {
  const plot = svg.match(/<g clip-path="url\(#pc_\d+\)">([\s\S]*?)<\/g>/)[1];
  return Array.from(plot.matchAll(/<line x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)" stroke="#1c2733" stroke-width="1\.3"\/>/g),
    (m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
}
function segmentDistance(p, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len)) : 0;
  return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy));
}
// Smallest distance from any point centre to any error-bar stroke centre line.
const whiskerGap = (svg, pts) => { const bars = whiskersOf(svg); return Math.min(...pts.map((p) => Math.min(...bars.map((s) => segmentDistance(p, s))))); };
// Centre-to-stroke distance at which a marker of radius r keeps the layout's 1.5-px
// gap from a whisker: its radius, its 0.8-px outline, and half the 1.3-px stroke.
// Checks allow 0.01 px for the 2-decimal data-px/data-py rounding.
const clearOfWhisker = (r) => r + 0.4 + 0.65 + 1.5;
const crowded = [
  { name: 'Ctrl', values: [10, 10.05, 10.1, 10.02, 12, 9.98, 10.07, 14, 10.03] },
  { name: 'Drug', values: [20, 20, 20, 20.1, 19.9, 25, 15, 20.05] },
  { name: 'Spread', values: [5, 8, 11, 14, 17, 20, 23] },
];
const dotSvg = Charts.dotPlot(crowded, {}), barSvg = Charts.barChart(crowded, { showPoints: true });
const dotPts = pointsOf(dotSvg);
const barPts = pointsOf(barSvg);
ok('dot plot draws every replicate', dotPts.length === crowded.reduce((n, g) => n + g.values.length, 0));
ok('dot plot keeps near-equal replicates apart (no marker overlap)', closestPair(dotPts) >= 2 * 3.6);
ok('bar chart points keep near-equal replicates apart (no marker overlap)', closestPair(barPts) >= 2 * 3.1);
ok('identical values stay at the same height (y encodes the value)', (() => {
  const ys = dotPts.filter((p) => p.g === 1 && crowded[1].values[p.i] === 20).map((p) => p.y);
  return ys.length === 3 && ys.every((y) => y === ys[0]);
})());
ok('swarmed points stay inside their own category slot', insideSlots(dotSvg, dotPts) && insideSlots(barSvg, barPts));
ok('points whose jittered spot is already clear (of points and the error bar) do not move', (() => {
  const { left, width: slot } = slotsOf(dotSvg)[2], spread = Math.min(46, slot * 0.5), cx = left + slot / 2;
  const bars = whiskersOf(dotSvg);
  let seed = 2 * 131 + 17, kept = 0;
  return dotPts.filter((p) => p.g === 2).every((p) => {
    seed = (seed * 9301 + 49297) % 233280;
    const jx = cx + (seed / 233280 - 0.5) * spread;
    if (Math.min(...bars.map((s) => segmentDistance({ x: jx, y: p.y }, s))) < clearOfWhisker(3.6)) return true;   // on the error bar: must move
    kept++;
    return Math.abs(p.x - jx) < 0.01;
  }) && kept >= 5;
})());
ok('isolated points keep their jitter spot even when their group has a packed cluster', (() => {
  // Ctrl's ~10 cluster is too wide for the usual cloud, so the group is packed; 12 and 14 are far from it.
  const { left, width: slot } = slotsOf(dotSvg)[0], spread = Math.min(46, slot * 0.5), cx = left + slot / 2;
  let seed = 0 * 131 + 17;
  const expected = crowded[0].values.map(() => { seed = (seed * 9301 + 49297) % 233280; return cx + (seed / 233280 - 0.5) * spread; });
  const ctrl = dotPts.filter((p) => p.g === 0);
  const cluster = ctrl.filter((p) => crowded[0].values[p.i] < 11);
  const moved = cluster.some((p) => Math.abs(p.x - expected[p.i]) > 0.01);
  return moved && ctrl.filter((p) => crowded[0].values[p.i] > 11).every((p) => Math.abs(p.x - expected[p.i]) < 0.01);
})());
ok('point layout is deterministic between renders', JSON.stringify(pointsOf(Charts.dotPlot(crowded, {}))) === JSON.stringify(dotPts));
ok('wide symbols (diamonds) also keep clear of each other', (() => {
  const pts = pointsOf(Charts.dotPlot(crowded, { markers: ['diamond', 'diamond', 'diamond'] }));
  return closestPair(pts) >= 2 * 3.6 * 1.4;
})());
ok('swarmOffsets packs exact ties side by side within the allowed width', (() => {
  const xs = Charts.swarmOffsets([0, 1, 2, 3, 4].map(() => ({ y: 100, pref: 0, r: 4 })), 30, 30).sort((a, b) => a - b);
  return xs.every((x, k) => k === 0 || x - xs[k - 1] >= 8.8 - 1e-9) && xs[0] >= -30 && xs[xs.length - 1] <= 30;
})());
ok('a very dense column stays finite, inside its slot, off its error bar and fast', (() => {
  // far too many ties to keep apart: markers may overlap each other, but not the whisker
  const dense = [{ name: 'Dense', values: Array.from({ length: 1200 }, (_, k) => 50 + (k % 5) * 0.001) }, { name: 'Other', values: [1, 2, 3] }];
  const t0 = Date.now();
  const svg = Charts.dotPlot(dense, {}), pts = pointsOf(svg);
  return Date.now() - t0 < 2000 && pts.length === 1203 && pts.every((p) => isFinite(p.x)) && insideSlots(svg, pts) &&
    whiskerGap(svg, pts) >= clearOfWhisker(3.6) - 0.01;
})());
ok('box plot spreads tied outliers instead of stacking them', (() => {
  const svg = Charts.boxPlot([{ name: 'A', values: [10, 11, 12, 11, 10, 12, 11, 10, 11, 12, 11, 10, 40, 40, 40] }], {});
  const cx = Array.from(svg.matchAll(/class="box-outlier" cx="([-\d.]+)"/g), (m) => +m[1]).sort((a, b) => a - b);
  return cx.length === 3 && cx[1] - cx[0] >= 7.2 && cx[2] - cx[1] >= 7.2;
})());

// Points beside an error bar slide sideways off the whisker instead of being drawn
// across it (bar charts used to fade such points to 32% opacity instead).
ok('bar chart points sit beside the error bar instead of across it', whiskersOf(barSvg).length === 12 && whiskerGap(barSvg, barPts) >= clearOfWhisker(3.1) - 0.01);
ok('bar chart points stay fully opaque (none faded behind the error bar)', !/\sopacity="/.test(barSvg));
ok('dot plot points sit beside the error bar instead of across it', whiskersOf(dotSvg).length === 9 && whiskerGap(dotSvg, dotPts) >= clearOfWhisker(3.6) - 0.01);
ok('error-bar clearance holds for every error type and for wide symbols', ['sd', 'sem', 'ci95'].every((errorType) => {
  const markers = ['diamond', 'cross', 'square'];
  const bar = Charts.barChart(crowded, { showPoints: true, errorType, markers }), dot = Charts.dotPlot(crowded, { errorType, markers });
  return [[bar, 3.1], [dot, 3.6]].every(([svg, r]) => {
    const pts = pointsOf(svg);
    return pts.every((p) => {
      const R = r * [1.4, 1.3, 1.12][p.g];
      return whiskerGap(svg, [p]) >= clearOfWhisker(R) - 0.01;
    }) && insideSlots(svg, pts) && closestPair(pts) >= 2 * r;
  });
}));
ok('one-sided error bars only keep points off the half that is drawn', (() => {
  // mean 20.2 ± SD 6.3: replicates 0 and 5 (15, 16) lie on the lower half, and their
  // jitter puts them on the centre line, which is clear when only the upper half is drawn
  const g = [{ name: 'A', values: [15, 26, 10, 30, 24, 16, 12, 28, 20, 22, 18, 21] }];
  const one = Charts.barChart(g, { showPoints: true, errorType: 'sd', errorBothSides: false });
  const both = Charts.barChart(g, { showPoints: true, errorType: 'sd' });
  const offCentre = (svg, i) => { const s = slotsOf(svg)[0]; return Math.abs(pointsOf(svg).find((p) => p.i === i).x - (s.left + s.width / 2)); };
  return whiskersOf(one).length === 2 && whiskerGap(one, pointsOf(one)) >= clearOfWhisker(3.1) - 0.01 &&
    [0, 5].every((i) => offCentre(one, i) < 3 && offCentre(both, i) >= clearOfWhisker(3.1) - 0.01);
})());
ok('swarmOffsets keeps tied points off a given error bar', (() => {
  const bar = { y0: 80, y1: 120, caps: [80, 120], capW: 7, hw: 0.65 };
  const onStem = Charts.swarmOffsets([0, 1, 2, 3].map(() => ({ y: 100, pref: 0, r: 4 })), 30, 30, bar).sort((a, b) => a - b);
  const onCap = Charts.swarmOffsets([0, 1, 2].map(() => ({ y: 80, pref: 0, r: 4 })), 30, 30, bar);
  return onStem.every((x, k) => Math.abs(x) >= 4 + 0.65 + 1.5 - 1e-9 && (k === 0 || x - onStem[k - 1] >= 8.8 - 1e-9)) &&
    onCap.every((x) => Math.abs(x) >= 7 + 4 + 0.65 + 1.5 - 1e-9 && Math.abs(x) <= 30);
})());
ok('a slot too narrow to clear the whisker keeps points inside it, with the whisker drawn over them', (() => {
  const many = Array.from({ length: 30 }, (_, k) => ({ name: 'G' + k, values: [10, 10.2, 9.8, 10.1, 9.9, 10.05] }));
  const svg = Charts.barChart(many, { showPoints: true }), pts = pointsOf(svg);
  const plot = svg.match(/<g clip-path="url\(#pc_\d+\)">([\s\S]*?)<\/g>/)[1];
  const columns = plot.split(/(?=<rect [^>]*rx="1\.5")/).filter((c) => c.includes('rx="1.5"'));
  return pts.length === 180 && pts.every((p) => isFinite(p.x)) && insideSlots(svg, pts) && columns.length === 30 &&
    columns.every((c) => c.lastIndexOf('class="data-point"') < c.indexOf('stroke-width="1.3"'));
})());
ok('error bars that run below a log axis leave point placement finite', (() => {
  const groups = [{ name: 'A', values: [1, 2, 30, 4, 5, 0.5] }, { name: 'B', values: [10, 12, 11] }];
  const opts = { errorType: 'sd', yAxis: { log: true } };
  return [Charts.barChart(groups, Object.assign({ showPoints: true }, opts)), Charts.dotPlot(groups, opts)].every((svg) => {
    const pts = pointsOf(svg);
    return pts.length === 9 && pts.every((p) => isFinite(p.x) && isFinite(p.y)) && insideSlots(svg, pts);
  });
})());

// Column charts size their plot to the categories so a few bars are not left with
// gaps several times wider than the bars (publication layout).
const viewWidth = (svg) => +svg.match(/viewBox="0 0 ([\d.]+) /)[1];
const barRects = (svg) => Array.from(svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"[^>]*rx="1\.5"/g), (m) => ({ x: +m[1], w: +m[2] }));
const gapsOf = (bars) => bars.slice(1).map((b, k) => b.x - (bars[k].x + bars[k].w));
const sameMarkup = (a, b) => a.replace(/pc_\d+/g, 'pc') === b.replace(/pc_\d+/g, 'pc');
const two = [{ name: 'Control', values: [10, 12, 11, 13, 9] }, { name: 'Treated', values: [18, 20, 17, 21, 19] }];
const three = [{ name: 'Vehicle', values: [10, 12, 11] }, { name: 'Low dose', values: [14, 15, 13] }, { name: 'High dose', values: [20, 22, 19] }];
ok('a two-bar figure keeps its bars close: each gap is narrower than a bar', (() => {
  const bars = barRects(Charts.barChart(two, {}));
  return bars.length === 2 && bars[0].w >= 50 && gapsOf(bars).every((g) => g > 20 && g < bars[0].w);
})());
ok('compact figures are narrower than the full-width default, not stretched bars', [two, three].every((groups) => {
  const svg = Charts.barChart(groups, {});
  return viewWidth(svg) < 400 && barRects(svg).every((b) => b.w <= 58);
}));
ok('turning compact spacing off restores the full-width layout exactly', (() => {
  const bars = barRects(Charts.barChart(two, { compactSpacing: false }));
  return viewWidth(Charts.barChart(two, { compactSpacing: false })) === 580 && bars[0].x === 162.5 && bars[1].x === 405.5 && bars[0].w === 58;
})());
ok('an explicit figure width keeps the full-width layout', viewWidth(Charts.barChart(two, { width: 640 })) === 640 && gapsOf(barRects(Charts.barChart(two, { width: 640 })))[0] > 200);
ok('charts with many categories are unchanged by compact spacing', (() => {
  const eight = 'ABCDEFGH'.split('').map((name, i) => ({ name, values: [i + 2, i + 3, i + 4] }));
  return sameMarkup(Charts.barChart(eight, {}), Charts.barChart(eight, { compactSpacing: false })) &&
    sameMarkup(Charts.dotPlot(eight, {}), Charts.dotPlot(eight, { compactSpacing: false })) &&
    sameMarkup(Charts.boxPlot(eight, {}), Charts.boxPlot(eight, { compactSpacing: false }));
})());
ok('dot and box plots use the same compact slots', [Charts.dotPlot(three, {}), Charts.boxPlot(three, {})].every((svg) => {
  const slots = slotsOf(svg);
  return viewWidth(svg) < 400 && slots.length === 3 && slots.every((s) => Math.abs(s.width - slots[0].width) < 1e-9 && s.width <= 100);
}));
ok('the bar-width slider still sets bars as a fraction of the (compact) slot', (() => {
  const svg = Charts.barChart(two, { barWidth: 0.9 }), slot = slotsOf(svg)[0].width;
  return Math.abs(barRects(svg)[0].w - 0.9 * slot) < 1e-6;
})());
ok('long category names widen the slots instead of colliding', (() => {
  const named = [{ name: 'Vehicle control (DMSO)', values: [10, 12, 11] }, { name: 'Compound 7b at 10 µM', values: [15, 16, 14] }];
  return slotsOf(Charts.barChart(named, {}))[0].width > slotsOf(Charts.barChart(two, {}))[0].width + 40;
})());
ok('a long title widens the figure but keeps the columns together under it', (() => {
  const plain = Charts.barChart(two, {}), titled = Charts.barChart(two, { title: 'Interleukin-6 secretion after 24 h of compound exposure' });
  const ys = (svg) => +svg.match(/translate\(([\d.]+),[\d.]+\) rotate\(-90\)/)[1];
  return viewWidth(titled) > viewWidth(plain) + 100 && Math.abs(gapsOf(barRects(titled))[0] - gapsOf(barRects(plain))[0]) < 1e-9 &&
    Math.abs((ys(titled) - ys(plain)) - (barRects(titled)[0].x - barRects(plain)[0].x)) < 1e-9;   // y-axis title moves with the plot
})());
ok('a dense point column gets the room it needs to stay clear in a compact figure', (() => {
  // the tied row sits right on its own tiny error bar, so it must also make room for the caps
  const tied = [{ name: 'Tied', values: Array.from({ length: 24 }, (_, k) => 50 + (k % 3) * 0.01) }, { name: 'Other', values: [10, 20, 30, 40] }];
  return [Charts.barChart(tied, { showPoints: true }), Charts.dotPlot(tied, {})].every((svg, k) => {
    const pts = pointsOf(svg), r = k ? 3.6 : 3.1;
    return pts.length === 28 && closestPair(pts) >= 2 * r && whiskerGap(svg, pts) >= clearOfWhisker(r) - 0.01 && insideSlots(svg, pts) && viewWidth(svg) < 580;
  });
})());
ok('grouped bar clusters sit close together, and turning compact spacing off restores them', (() => {
  const svg = Charts.groupedBar(cells.slice(0, 2), rows.slice(0, 2), cols, {}), bars = barRects(svg);
  const legacy = barRects(Charts.groupedBar(cells.slice(0, 2), rows.slice(0, 2), cols, { compactSpacing: false }));
  const clusterGap = bars[2].x - (bars[1].x + bars[1].w), legacyGap = legacy[2].x - (legacy[1].x + legacy[1].w);
  return viewWidth(svg) < 580 && clusterGap < 45 && clusterGap > 20 && legacyGap > 80;
})());

// Every drawn data point carries its hover read-out (a title and [label, value] rows
// as JSON in data-pt), stamped after its centre so the hit-test attributes stay put.
const unescAttr = (s) => s.replace(/&quot;|&lt;|&gt;|&amp;/g, (e) => ({ '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' }[e]));
function tipsOf(svg) {
  return Array.from(svg.matchAll(/(?:data-pg="(\d+)" data-pi="(\d+)" )?data-px="([^"]+)" data-py="([^"]+)" data-pt="([^"]*)"/g),
    (m) => Object.assign({ g: m[1] == null ? null : +m[1], i: m[2] == null ? null : +m[2], x: +m[3], y: +m[4] }, JSON.parse(unescAttr(m[5]))));
}
ok('bar and dot points show their group and exact value on hover', [barSvg, dotSvg].every((svg) => {
  const tips = tipsOf(svg);
  return tips.length === pointsOf(svg).length && tips.length === 24 &&
    tips.every((p) => p.t === crowded[p.g].name && p.r.length === 1 && p.r[0][0] === 'Value' && p.r[0][1] === String(crowded[p.g].values[p.i]));
}));
ok('bar charts keep their per-bar stats tooltip, with or without points', (() => {
  const plain = Charts.barChart(crowded, {}), stats = (svg) => (svg.match(/class="cat-hit" data-i="\d+" data-tip="1" data-name="[^"]+" data-n="\d+" data-mean=/g) || []).length;
  return tipsOf(plain).length === 0 && stats(plain) === 3 && stats(barSvg) === 3;
})());
ok('point values print as entered, without binary float noise', (() => {
  const tips = tipsOf(Charts.dotPlot([{ name: 'A', values: [0.1 + 0.2, 1.005, -2.5e-7, 123456789] }], {}));
  return JSON.stringify(tips.map((p) => p.r[0][1])) === JSON.stringify(['0.3', '1.005', '-2.5e-7', '123456789']);
})());
ok('point read-outs survive quotes and markup in group names', (() => {
  const name = 'A "quoted" <b>&amp;</b> group';
  const tips = tipsOf(Charts.barChart([{ name, values: [1, 2, 3] }], { showPoints: true }));
  return tips.length === 3 && tips.every((p) => p.t === name);
})());
ok('XY points show their X and Y values under the axis names', (() => {
  const tips = tipsOf(Charts.xyPlot([1, 2.5, 4], [10, 20, 35], { xLabel: 'Dose (mg)', yLabel: 'Response' }));
  const plain = tipsOf(Charts.xyPlot([1, 2], [3, 4], {}));
  return tips.length === 3 && tips[1].t === 'Point 2' && JSON.stringify(tips[1].r) === JSON.stringify([['Dose (mg)', '2.5'], ['Response', '20']]) &&
    JSON.stringify(plain[0].r) === JSON.stringify([['X', '1'], ['Y', '3']]);
})());
ok('line-plot points show the mean, its error and n for their cell', (() => {
  const tips = tipsOf(line), first = tips.find((p) => p.g === 0 && p.i === 0);
  const sd = tipsOf(Charts.groupedLine(cells, rows, cols, { errorType: 'sd' })).find((p) => p.g === 1 && p.i === 2);
  const none = tipsOf(Charts.groupedLine(cells, rows, cols, { errorType: 'none' }))[0];
  const single = tipsOf(Charts.groupedLine([[[4.25]]], ['Day 0'], ['WT'], {}))[0];
  return tips.length === 6 && first.t === 'WT · Day 0' && JSON.stringify(first.r) === JSON.stringify([['Mean', '2'], ['± SEM', '0.5774'], ['n', '3']]) &&
    sd.t === 'Mutant · Day 14' && JSON.stringify(sd.r) === JSON.stringify([['Mean', '9'], ['± SD', '1'], ['n', '3']]) &&
    JSON.stringify(none.r) === JSON.stringify([['Mean', '2'], ['n', '3']]) && JSON.stringify(single.r) === JSON.stringify([['Value', '4.25']]);
})());
ok('before–after points show the whole pair and its change', (() => {
  const tips = tipsOf(Charts.pairedPlot(['5', '', '8.2'], ['7.1', '3', '6'], { labelA: 'Pre', labelB: 'Post' }));
  const row = (p) => JSON.stringify([p.t, p.r]);
  return tips.length === 4 && row(tips[0]) === row(tips[1]) && row(tips[2]) === row(tips[3]) &&
    row(tips[0]) === JSON.stringify(['Pair 1', [['Pre', '5'], ['Post', '7.1'], ['Change', '+2.1']]]) &&
    row(tips[2]) === JSON.stringify(['Pair 2', [['Pre', '8.2'], ['Post', '6'], ['Change', '-2.2']]]);
})());
ok('box-plot outliers show their value; the box itself has none', (() => {
  const svg = Charts.boxPlot([{ name: 'A', values: [10, 11, 12, 11, 10, 12, 11, 10, 11, 12, 11, 10, 40, 40, 40] }], {});
  const tips = tipsOf(svg), cx = Array.from(svg.matchAll(/class="box-outlier" cx="([-\d.]+)"/g), (m) => +m[1]);
  return tips.length === 3 && tips.every((p, k) => p.t === 'A' && JSON.stringify(p.r) === JSON.stringify([['Outlier', '40']]) && Math.abs(p.x - cx[k]) < 0.01);
})());

console.log(`\n${pass} UI/data checks passed`);
