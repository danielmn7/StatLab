/*
 * survival.js — Kaplan-Meier estimation and log-rank / Gehan-Breslow tests.
 * Input rows: { time:Number, event:0|1, group:String }  (event 1=death, 0=censored)
 * Depends on StatCore.
 */
const Survival = (function (C) {
  'use strict';

  // Kaplan-Meier for one group. Returns step points and median.
  function kaplanMeier(rows) {
    const data = rows.filter((r) => r.time != null && r.time !== '' && !Number.isNaN(Number(r.time)))
      .map((r) => ({ time: Number(r.time), event: Number(r.event) ? 1 : 0 }))
      .sort((a, b) => a.time - b.time);
    const n0 = data.length;
    // distinct times
    const steps = [{ time: 0, n: n0, d: 0, c: 0, S: 1, se: 0, lo: 1, hi: 1 }];
    let atRisk = n0;
    let S = 1;
    let cumVar = 0; // Greenwood sum of d/(n(n-d))
    let i = 0;
    const eventTimes = [];
    while (i < data.length) {
      const t = data[i].time;
      let d = 0, c = 0;
      while (i < data.length && data[i].time === t) { if (data[i].event === 1) d++; else c++; i++; }
      const nAtT = atRisk;
      if (d > 0) {
        S *= (1 - d / nAtT);
        cumVar += d / (nAtT * (nAtT - d));
        const seS = S * Math.sqrt(cumVar); // Greenwood SE
        // log-log (complementary log-log) 95% CI
        let lo = S, hi = S;
        if (S > 0 && S < 1) {
          const z = 1.959963985;
          const logS = Math.log(S);
          const seLL = Math.sqrt(cumVar) / Math.abs(logS);
          lo = Math.pow(S, Math.exp(z * seLL));
          hi = Math.pow(S, Math.exp(-z * seLL));
        }
        steps.push({ time: t, n: nAtT, d, c, S, se: seS, lo, hi });
        eventTimes.push({ time: t, S });
      } else {
        // pure censoring time — record for tick marks but S unchanged
        steps.push({ time: t, n: nAtT, d: 0, c, S, se: steps[steps.length - 1].se, lo: steps[steps.length - 1].lo, hi: steps[steps.length - 1].hi, censorOnly: true });
      }
      atRisk -= (d + c);
    }
    // median survival: first event time where S <= 0.5
    let median = null;
    for (const e of eventTimes) { if (e.S <= 0.5) { median = e.time; break; } }
    const censorTimes = data.filter((r) => r.event === 0).map((r) => r.time);
    return { n: n0, events: data.filter((r) => r.event === 1).length, censored: censorTimes.length, steps, median, censorTimes, finalS: S };
  }

  // Build risk/event table over pooled distinct event times for log-rank
  function logRank(rows, useGehan = false) {
    const groups = [...new Set(rows.map((r) => r.group))];
    const g = groups.length;
    const byGroup = {};
    groups.forEach((name) => {
      byGroup[name] = rows.filter((r) => r.group === name)
        .map((r) => ({ time: Number(r.time), event: Number(r.event) ? 1 : 0 }))
        .sort((a, b) => a.time - b.time);
    });
    // pooled distinct event times
    const allEventTimes = [...new Set(rows.filter((r) => Number(r.event) === 1).map((r) => Number(r.time)))].sort((a, b) => a - b);

    const O = new Array(g).fill(0);
    const E = new Array(g).fill(0);
    // covariance accumulator V ((g)x(g)), we will use first g-1 rows/cols
    const V = Array.from({ length: g }, () => new Array(g).fill(0));

    function atRiskCount(arr, t) { return arr.filter((x) => x.time >= t).length; }
    function eventsAt(arr, t) { return arr.filter((x) => x.time === t && x.event === 1).length; }

    for (const t of allEventTimes) {
      const nj = groups.map((name) => atRiskCount(byGroup[name], t));
      const dj = groups.map((name) => eventsAt(byGroup[name], t));
      const nTot = nj.reduce((s, v) => s + v, 0);
      const dTot = dj.reduce((s, v) => s + v, 0);
      if (nTot <= 1) continue;
      const w = useGehan ? nTot : 1; // Gehan-Breslow weights by n at risk
      for (let j = 0; j < g; j++) {
        const eij = dTot * nj[j] / nTot;
        O[j] += w * dj[j];
        E[j] += w * eij;
      }
      // covariance (hypergeometric) — multiply by w^2
      const factor = (dTot * (nTot - dTot)) / (nTot * nTot * (nTot - 1));
      for (let j = 0; j < g; j++) {
        for (let l = 0; l < g; l++) {
          const delta = j === l ? 1 : 0;
          V[j][l] += w * w * factor * nj[j] * (delta * nTot - nj[l]);
        }
      }
    }

    // chi-square = z' Vinv z using first g-1 components
    const m = g - 1;
    const z = [];
    for (let j = 0; j < m; j++) z.push(O[j] - E[j]);
    const Vsub = [];
    for (let j = 0; j < m; j++) { Vsub.push(V[j].slice(0, m)); }
    const x = solve(Vsub, z);
    let chi2 = 0;
    for (let j = 0; j < m; j++) chi2 += z[j] * x[j];
    const df = m;
    const p = C.chiSquareP(chi2, df);

    // observed/expected and hazard ratio (for 2 groups)
    const perGroup = groups.map((name, j) => ({ name, O: O[j], E: E[j], OE: E[j] > 0 ? O[j] / E[j] : NaN }));
    let hazardRatio = null;
    if (g === 2 && E[0] > 0 && E[1] > 0) {
      hazardRatio = (O[0] / E[0]) / (O[1] / E[1]);
    }

    return {
      test: useGehan ? 'Gehan-Breslow-Wilcoxon test' : 'Log-rank (Mantel-Cox) test',
      groups, chi2, df, p, perGroup, hazardRatio,
    };
  }

  // Gaussian elimination solve A x = b (A small, symmetric pos-def)
  function solve(A, b) {
    const n = b.length;
    if (n === 0) return [];
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      // pivot
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      const pv = M[col][col];
      if (Math.abs(pv) < 1e-300) continue;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / pv;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n);
    for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
    return x;
  }

  function analyze(rows) {
    const groups = [...new Set(rows.map((r) => r.group))];
    const km = {};
    groups.forEach((name) => { km[name] = kaplanMeier(rows.filter((r) => r.group === name)); });
    const result = { groups, km };
    if (groups.length >= 2) {
      result.logRank = logRank(rows, false);
      result.gehan = logRank(rows, true);
    }
    return result;
  }

  return { kaplanMeier, logRank, analyze };
})(typeof StatCore !== 'undefined' ? StatCore : require('./stats-core.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = Survival;
