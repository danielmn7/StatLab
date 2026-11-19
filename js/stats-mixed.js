/*
 * stats-mixed.js — repeated-measures two-way ANOVA and the mixed-effects model for
 * one-way and two-way repeated-measures designs (missing values allowed).
 * Depends on StatCore and StatTests.
 *
 * Methods (formulas written from the published descriptions):
 *   Repeated-measures ANOVA  univariate tests on orthonormal within-subject contrast
 *                            scores, Type III for unequal group sizes; Geisser–Greenhouse
 *                            epsilon (Box 1954; Greenhouse & Geisser 1959).
 *   Mixed-effects model      fixed cell means, random subject (and subject × factor when
 *                            both factors are repeated), compound symmetry, fitted by
 *                            REML with Fisher scoring (Patterson & Thompson 1971;
 *                            Searle, Casella & McCulloch 1992, ch. 6 and 8).
 *   Denominator df           Kenward & Roger (1997), Biometrics 53:983–997: adjusted
 *                            covariance of the fixed effects, scaled F, approximate df.
 */
const StatMixed = (function (C, T) {
  'use strict';

  const H = T._internal;
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const variance = (v) => { const m = mean(v); return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1); };
  const isNum = (v) => v !== '' && v != null && !(typeof v === 'string' && v.trim() === '') && Number.isFinite(Number(v));

  // ---------- small dense linear algebra ----------
  const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
  const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));
  function mul(A, B) {
    const r = A.length, c = B[0].length, n = B.length, out = zeros(r, c);
    for (let i = 0; i < r; i++) for (let k = 0; k < n; k++) { const a = A[i][k]; if (a === 0) continue; for (let j = 0; j < c; j++) out[i][j] += a * B[k][j]; }
    return out;
  }
  const mulVec = (A, v) => A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
  const trace = (A) => A.reduce((s, row, i) => s + row[i], 0);
  // tr(A B) without forming the product.
  const traceProd = (A, B) => { let s = 0; for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) s += A[i][j] * B[j][i]; return s; };
  const addScaled = (A, B, f) => { for (let i = 0; i < A.length; i++) for (let j = 0; j < A[i].length; j++) A[i][j] += f * B[i][j]; };
  // Inverse and log-determinant of a symmetric positive-definite matrix (Cholesky).
  function spdInverse(A) {
    const n = A.length, L = zeros(n, n);
    let logdet = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); logdet += Math.log(s); } else L[i][j] = s / L[j][j];
    }
    const Li = zeros(n, n);
    for (let i = 0; i < n; i++) {
      Li[i][i] = 1 / L[i][i];
      for (let j = 0; j < i; j++) { let s = 0; for (let k = j; k < i; k++) s -= L[i][k] * Li[k][j]; Li[i][j] = s / L[i][i]; }
    }
    const inv = zeros(n, n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = i; k < n; k++) s += Li[k][i] * Li[k][j]; inv[i][j] = inv[j][i] = s; }
    return { inv, logdet };
  }
  // General inverse (Gauss–Jordan, partial pivoting); null when singular.
  function inverse(A) {
    const n = A.length, M = A.map((row, i) => row.concat(row.map((_, j) => (i === j ? 1 : 0))));
    let scale = 0; for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i][i]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (!(Math.abs(M[piv][col]) > 1e-12 * (scale || 1))) return null;
      [M[col], M[piv]] = [M[piv], M[col]];
      const pv = M[col][col];
      for (let c = 0; c < 2 * n; c++) M[col][c] /= pv;
      for (let r = 0; r < n; r++) { if (r === col) continue; const f = M[r][col]; if (f === 0) continue; for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c]; }
    }
    return M.map((row) => row.slice(n));
  }
  const quad = (x, A, y) => { let s = 0; for (let i = 0; i < x.length; i++) { if (x[i] === 0) continue; for (let j = 0; j < y.length; j++) s += x[i] * A[i][j] * y[j]; } return s; };

  // ---------- fixed-effects coding (sum to zero, as in the two-way ANOVA) ----------
  const sumZero = (level, L) => { const c = []; for (let k = 0; k < L - 1; k++) c.push(level === k ? 1 : (level === L - 1 ? -1 : 0)); return c; };
  // Design row for cell (i, j) of an a × b layout: intercept, row effects, column
  // effects, interaction. b = 1 gives the one-way coding.
  function cellRow(i, j, a, b) {
    const ac = sumZero(i, a), bc = sumZero(j, b), row = [1].concat(ac, bc);
    for (const x of ac) for (const y of bc) row.push(x * y);
    return row;
  }
  const unitRows = (from, count, p) => Array.from({ length: count }, (_, k) => { const r = new Array(p).fill(0); r[from + k] = 1; return r; });

  // ---------- REML fit of y = Xβ + Σ Z_t u_t + e ----------
  // blocks: one per subject, { X: rows, y, keys: [per random term, a level id per
  // observation] }. Observations of different subjects are independent, so every
  // quantity is accumulated subject by subject. theta = [residual variance, one
  // variance per random term]; a variance that would be negative is held at zero.
  function remlFit(blocks, p, nTerms) {
    const N = blocks.reduce((s, b) => s + b.y.length, 0), T1 = nTerms + 1;
    if (N - p < 2) return { error: 'Not enough values to fit the model: add more subjects or measurements.' };
    for (const b of blocks) {
      const n = b.y.length;
      b.G = [null];
      for (let t = 0; t < nTerms; t++) { const k = b.keys[t]; b.G.push(k.map((ki) => k.map((kj) => (ki === kj ? 1 : 0)))); }
      b.Xt = transpose(b.X); b.n = n;
    }
    // Ordinary least squares gives the starting variances.
    const XtX = zeros(p, p), Xty = new Array(p).fill(0);
    for (const b of blocks) for (let r = 0; r < b.n; r++) { const x = b.X[r]; for (let i = 0; i < p; i++) { Xty[i] += x[i] * b.y[r]; for (let j = 0; j < p; j++) XtX[i][j] += x[i] * x[j]; } }
    const XtXi = inverse(XtX);
    if (!XtXi) return { error: 'Every combination of the two factors needs at least one value.' };
    const b0 = mulVec(XtXi, Xty);
    let rss = 0, tss = 0; const ybar = blocks.reduce((s, b) => s + b.y.reduce((u, v) => u + v, 0), 0) / N;
    for (const b of blocks) for (let r = 0; r < b.n; r++) { rss += (b.y[r] - b.X[r].reduce((s, x, i) => s + x * b0[i], 0)) ** 2; tss += (b.y[r] - ybar) ** 2; }
    if (!(rss > 1e-13 * tss)) return { error: 'No residual variation: the model fits every value exactly, so F is undefined.' };
    const s2 = rss / (N - p);
    const ols = { ll: -0.5 * ((N - p) * Math.log(s2) + Math.log(detSym(XtX)) + (N - p)) - 0.5 * (N - p) * Math.log(2 * Math.PI) };

    // Everything the likelihood, the scoring step and Kenward–Roger need at theta.
    const evaluate = (theta, full) => {
      const XVX = zeros(p, p), XVy = new Array(p).fill(0);
      let logdetV = 0;
      const P = full ? Array.from({ length: T1 }, () => zeros(p, p)) : null;
      const Q = full ? Array.from({ length: T1 }, () => Array.from({ length: T1 }, () => zeros(p, p))) : null;
      const trVG = new Array(T1).fill(0), trVGVG = zeros(T1, T1);
      const store = [];
      for (const b of blocks) {
        const n = b.n, V = zeros(n, n);
        for (let i = 0; i < n; i++) { V[i][i] = theta[0]; }
        for (let t = 1; t < T1; t++) if (theta[t] !== 0) addScaled(V, b.G[t], theta[t]);
        const ch = spdInverse(V);
        if (!ch) return null;
        logdetV += ch.logdet;
        const Vi = ch.inv, XtVi = mul(b.Xt, Vi);
        addScaled(XVX, mul(XtVi, b.X), 1);
        const xvy = mulVec(XtVi, b.y); for (let i = 0; i < p; i++) XVy[i] += xvy[i];
        store.push({ b, Vi });
        if (!full) continue;
        const A = [Vi]; for (let t = 1; t < T1; t++) A.push(mul(Vi, b.G[t]));           // V⁻¹G_t
        const XG = [XtVi]; for (let t = 1; t < T1; t++) XG.push(mul(XtVi, b.G[t]));      // X'V⁻¹G_t
        const XViT = transpose(XtVi);
        for (let i = 0; i < T1; i++) {
          trVG[i] += trace(A[i]);
          addScaled(P[i], mul(XG[i], XViT), 1);
          const XGV = mul(XG[i], Vi);
          for (let j = 0; j < T1; j++) {
            trVGVG[i][j] += traceProd(A[i], A[j]);
            addScaled(Q[i][j], mul(XGV, transpose(XG[j])), 1);
          }
        }
      }
      const Phi = inverse(XVX);
      if (!Phi) return null;
      const beta = mulVec(Phi, XVy);
      let rVr = 0;
      const wGw = new Array(T1).fill(0);
      for (const s of store) {
        const b = s.b, r = b.y.map((y, k) => y - b.X[k].reduce((u, x, i) => u + x * beta[i], 0));
        const w = mulVec(s.Vi, r);
        rVr += r.reduce((u, x, k) => u + x * w[k], 0);
        if (full) { wGw[0] += w.reduce((u, x) => u + x * x, 0); for (let t = 1; t < T1; t++) wGw[t] += quad(w, b.G[t], w); }
      }
      const ll = -0.5 * (logdetV + Math.log(detSym(XVX)) + rVr) - 0.5 * (N - p) * Math.log(2 * Math.PI);
      if (!full) return { ll };
      // tr(P_M G_i) and tr(P_M G_i P_M G_j), P_M = V⁻¹ − V⁻¹XΦX'V⁻¹.
      const PhiP = P.map((Pi) => mul(Phi, Pi));
      const score = new Array(T1), info = zeros(T1, T1);
      for (let i = 0; i < T1; i++) {
        score[i] = -0.5 * (trVG[i] - trace(PhiP[i])) + 0.5 * wGw[i];
        for (let j = 0; j < T1; j++) info[i][j] = 0.5 * (trVGVG[i][j] - 2 * traceProd(Phi, Q[i][j]) + traceProd(PhiP[i], PhiP[j]));
      }
      return { ll, beta, Phi, P, Q, score, info };
    };

    let theta = [s2 / 2].concat(new Array(nTerms).fill(s2 / (2 * Math.max(1, nTerms))));
    let cur = evaluate(theta, true);
    if (!cur) return { error: 'The model could not be fitted to these data.' };
    const floor = 1e-10 * s2;
    let converged = false;
    for (let iter = 0; iter < 200; iter++) {
      // A variance at zero whose likelihood slope points below zero stays there.
      const free = []; for (let i = 0; i < T1; i++) if (i === 0 || theta[i] > 0 || cur.score[i] > 0) free.push(i);
      const infoF = free.map((i) => free.map((j) => cur.info[i][j]));
      const inv = inverse(infoF);
      if (!inv) return { error: 'The variance components cannot be told apart with these data (too few repeated values per subject).' };
      const delta = new Array(T1).fill(0);
      mulVec(inv, free.map((i) => cur.score[i])).forEach((d, k) => { delta[free[k]] = d; });
      // Shorten the step to stay inside the allowed region, then until the likelihood rises.
      let step = 1;
      for (let i = 0; i < T1; i++) if (delta[i] < 0) { const lim = i === 0 ? theta[0] - floor : theta[i]; if (-delta[i] * step > lim) step = lim / -delta[i]; }
      let next = null, cand = null;
      for (let half = 0; half < 40; half++) {
        cand = theta.map((v, i) => { const x = v + step * delta[i]; return i === 0 ? Math.max(floor, x) : (x < 1e-12 * s2 ? 0 : x); });
        const e = evaluate(cand, false);
        if (e && e.ll >= cur.ll - 1e-12 * Math.abs(cur.ll)) { next = e; break; }
        step /= 2;
      }
      if (!next) { converged = true; break; }
      const moved = Math.max(...cand.map((v, i) => Math.abs(v - theta[i]))) / s2;
      theta = cand;
      cur = evaluate(theta, true);
      if (!cur) return { error: 'The model could not be fitted to these data.' };
      if (moved < 1e-11) { converged = true; break; }
    }

    // Kenward–Roger adjusted covariance of the fixed effects. W is the asymptotic
    // covariance of the variance estimates (inverse expected REML information).
    const W = inverse(cur.info);
    const Phi = cur.Phi;
    let PhiA = Phi, kr = null;
    if (W) {
      const sum = zeros(p, p);
      for (let i = 0; i < T1; i++) for (let j = 0; j < T1; j++) {
        if (W[i][j] === 0) continue;
        const PiPhiPj = mul(mul(cur.P[i], Phi), cur.P[j]);
        for (let r = 0; r < p; r++) for (let c = 0; c < p; c++) sum[r][c] += W[i][j] * (cur.Q[i][j][r][c] - PiPhiPj[r][c]);
      }
      PhiA = Phi.map((row) => row.slice());
      addScaled(PhiA, mul(mul(Phi, sum), Phi), 2);
      kr = { W, PhiP: cur.P.map((Pi) => mul(mul(Phi, Pi), Phi)) }; // Φ P_i Φ
    }
    return {
      theta, beta: cur.beta, Phi, PhiA, kr, ll: cur.ll, llNoRandom: ols.ll, N, p, nTerms, converged,
      boundary: theta.slice(1).some((v) => v === 0),
    };
  }
  // Determinant of a symmetric positive-definite matrix.
  function detSym(A) { const ch = spdInverse(A); return ch ? Math.exp(ch.logdet) : NaN; }

  // Kenward–Roger test of L β = 0 (L: q rows). Returns the scaled F, its degrees of
  // freedom and, for one row, the unscaled estimate and standard error used for
  // comparisons of means.
  function krTest(fit, L) {
    if (L.length === 1) return krContrast(fit, L[0]);
    const q = L.length, Lt = transpose(L);
    const est = mulVec(L, fit.beta);
    const cov = mul(mul(L, fit.PhiA), Lt), covInv = inverse(cov);
    if (!covInv) return null;
    const wald = quad(est, covInv, est);
    let df2 = Infinity, scale = 1;
    if (fit.kr) {
      const mid = inverse(mul(mul(L, fit.Phi), Lt));
      if (!mid) return null;
      const Theta = mul(mul(Lt, mid), L);                           // L'(LΦL')⁻¹L
      const U = fit.kr.PhiP.map((M) => mul(Theta, M));              // Θ Φ P_i Φ
      let A1 = 0, A2 = 0;
      for (let i = 0; i < U.length; i++) for (let j = 0; j < U.length; j++) {
        A1 += fit.kr.W[i][j] * trace(U[i]) * trace(U[j]);
        A2 += fit.kr.W[i][j] * traceProd(U[i], U[j]);
      }
      const B = (A1 + 6 * A2) / (2 * q);
      const g = ((q + 1) * A1 - (q + 4) * A2) / ((q + 2) * A2);
      const den = 3 * q + 2 * (1 - g);
      const c1 = g / den, c2 = (q - g) / den, c3 = (q + 2 - g) / den;
      let V0 = 1 + c1 * B; const V1 = 1 - c2 * B, V2 = 1 - c3 * B;
      if (Math.abs(V0) < 1e-10) V0 = 0;
      const rho = (1 / q) * ((1 - A2 / q) / V1) ** 2 * V0 / V2;
      df2 = 4 + (q + 2) / (q * rho - 1);
      scale = Math.abs(df2 - 2) < 1e-2 ? 1 : df2 * (1 - A2 / q) / (df2 - 2);
      if (!(A2 > 0) || !Number.isFinite(df2)) { df2 = fit.N - fit.p; scale = 1; }
    }
    const F = scale * wald / q;
    return { F, df1: q, df2, p: C.fDistP(F, q, df2), estimate: est[0], se: Math.sqrt(cov[0][0]) };
  }

  // The same test for a single contrast l'β, without forming p × p products: with one
  // row, Θ = l l'/(l'Φl), so both sums reduce to Σ W_ij a_i a_j with a_i = l'ΦP_iΦl/(l'Φl).
  function krContrast(fit, l) {
    const estimate = l.reduce((s, x, i) => s + x * fit.beta[i], 0);
    const varA = quad(l, fit.PhiA, l);
    if (!(varA > 0)) return null;
    let df2 = Infinity, scale = 1;
    if (fit.kr) {
      const v = quad(l, fit.Phi, l), a = fit.kr.PhiP.map((M) => quad(l, M, l) / v);
      let A = 0;
      for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) A += fit.kr.W[i][j] * a[i] * a[j];
      // q = 1: A1 = A2 = A, g = −1, so c1 = −1/7, c2 = 2/7, c3 = 4/7 and B = 7A/2.
      let V0 = 1 - A / 2; const V1 = 1 - A, V2 = 1 - 2 * A;
      if (Math.abs(V0) < 1e-10) V0 = 0;
      const rho = ((1 - A) / V1) ** 2 * V0 / V2;
      df2 = 4 + 3 / (rho - 1);
      scale = Math.abs(df2 - 2) < 1e-2 ? 1 : df2 * (1 - A) / (df2 - 2);
      if (!(A > 0) || !Number.isFinite(df2)) { df2 = fit.N - fit.p; scale = 1; }
    }
    const F = scale * estimate * estimate / varA;
    return { F, df1: 1, df2, p: C.fDistP(F, 1, df2), estimate, se: Math.sqrt(varA) };
  }

  // ---------- reading a grouped table as subjects ----------
  // grid[i][j][s] = value or null for row i, column group j, subcolumn s.
  //   rows repeated     one subject per (column group, subcolumn), measured in every row
  //   columns repeated  one subject per (row, subcolumn), measured in every column group
  //   both              one subject per subcolumn number, measured in every cell
  function subjectIndex(matching, i, j, s, a, b, nsub) {
    if (matching === 'rows') return j * nsub + s;
    if (matching === 'cols') return i * nsub + s;
    return s;
  }
  function subjectLayout(grid, matching, rowNames, colNames) {
    const a = grid.length, b = a ? grid[0].length : 0, nsub = a && b ? grid[0][0].length : 0;
    const need = matching === 'rows' ? a : matching === 'cols' ? b : a * b;
    const map = new Map();
    let values = 0;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let s = 0; s < nsub; s++) {
      const v = grid[i][j][s];
      if (v == null) continue;
      values++;
      const id = subjectIndex(matching, i, j, s, a, b, nsub);
      if (!map.has(id)) {
        map.set(id, {
          id, sub: s, group: matching === 'rows' ? j : matching === 'cols' ? i : 0, obs: [],
          label: matching === 'rows' ? (colNames ? colNames[j] : 'Group ' + (j + 1)) + ' · ' + (s + 1)
            : matching === 'cols' ? (rowNames ? rowNames[i] : 'Row ' + (i + 1)) + ' · ' + (s + 1) : 'Subject ' + (s + 1),
        });
      }
      map.get(id).obs.push({ i, j, y: v });
    }
    const subjects = [...map.values()].sort((x, y) => x.id - y.id);
    subjects.forEach((u, k) => { u.index = k; u.complete = u.obs.length === need; });
    const incomplete = subjects.filter((u) => !u.complete);
    return {
      matching, a, b, nsub, need, subjects, incomplete, values,
      completeValues: subjects.filter((u) => u.complete).length * need,
      indexOf: (i, j, s) => { const u = map.get(subjectIndex(matching, i, j, s, a, b, nsub)); return u ? u.index : -1; },
    };
  }

  // Orthonormal contrasts among k levels (normalized Helmert), k − 1 rows.
  function contrasts(k) {
    const out = [];
    for (let c = 1; c < k; c++) { const f = 1 / Math.sqrt(c * (c + 1)), row = new Array(k).fill(0); for (let i = 0; i < c; i++) row[i] = f; row[c] = -c * f; out.push(row); }
    return out;
  }
  // Geisser–Greenhouse epsilon from the error cross-product matrix of orthonormal
  // contrast scores: tr(E)² / (d · tr(E²)), bounded by 1/d and 1.
  function epsilonOf(E) {
    const d = E.length;
    if (d < 2) return 1;
    const e = trace(E) ** 2 / (d * traceProd(E, E));
    return Number.isFinite(e) ? Math.min(1, Math.max(1 / d, e)) : 1;
  }
  // Univariate repeated-measures test from contrast scores. scores[s] = contrast
  // scores of subject s, group[s] = its between-subject level (g levels).
  //   average    H0: the contrast means, averaged evenly over the groups, are zero
  //   between    H0: the contrast means are the same in every group
  function scoreTests(scores, group, g) {
    const d = scores[0].length, ns = new Array(g).fill(0), means = zeros(g, d);
    scores.forEach((z, s) => { ns[group[s]]++; for (let c = 0; c < d; c++) means[group[s]][c] += z[c]; });
    for (let j = 0; j < g; j++) for (let c = 0; c < d; c++) means[j][c] /= ns[j];
    const E = zeros(d, d);
    scores.forEach((z, s) => { const m = means[group[s]]; for (let x = 0; x < d; x++) for (let y = 0; y < d; y++) E[x][y] += (z[x] - m[x]) * (z[y] - m[y]); });
    const n = scores.length, harmonic = ns.reduce((u, v) => u + 1 / v, 0) / (g * g);
    let ssAverage = 0, ssBetween = 0;
    for (let c = 0; c < d; c++) {
      const avg = means.reduce((u, m) => u + m[c], 0) / g;
      ssAverage += avg * avg / harmonic;
      const weighted = means.reduce((u, m, j) => u + ns[j] * m[c], 0) / n;
      ssBetween += means.reduce((u, m, j) => u + ns[j] * (m[c] - weighted) ** 2, 0);
    }
    return { d, ssAverage, ssBetween, ssError: trace(E), dfError: (n - g) * d, epsilon: epsilonOf(E) };
  }

  const interactionName = (r, c) => 'Interaction (' + r + ' × ' + c + ')';

  // ---------- two-way repeated measures ----------
  // opts.matching  'rows' | 'cols' | 'both'
  // opts.method    'auto' (ANOVA; mixed model when a value is missing) | 'rm' (ANOVA on
  //                subjects with complete data) | 'mixed'
  // opts.sphericity  true assumes sphericity in the ANOVA; otherwise Geisser–Greenhouse.
  function twoWayRepeated(grid, rowNames, colNames, opts) {
    opts = opts || {};
    const matching = opts.matching;
    const factorRow = opts.rowFactor || 'Rows', factorCol = opts.colFactor || 'Columns';
    const a = grid.length, b = a ? grid[0].length : 0;
    if (a < 2 || b < 2) return { error: 'Two-way ANOVA needs at least 2 rows and 2 column groups.' };
    if (!['rows', 'cols', 'both'].includes(matching)) return { error: 'Choose which factor is repeated.' };
    const layout = subjectLayout(grid, matching, rowNames, colNames);
    const missing = layout.incomplete.length > 0;
    const method = ['rm', 'mixed'].includes(opts.method) ? opts.method : 'auto';
    const mode = method === 'mixed' || (method === 'auto' && missing) ? 'mixed' : 'rm';
    const used = mode === 'rm' ? layout.subjects.filter((u) => u.complete) : layout.subjects;
    const base = {
      matching, method, mode, a, b, rowNames, colNames, factorRow, factorCol,
      subjectsTotal: layout.subjects.length, subjectsUsed: used.length,
      subjectsIncomplete: layout.incomplete.length, droppedLabels: mode === 'rm' ? layout.incomplete.map((u) => u.label) : [],
      valuesTotal: layout.values,
    };
    // Cell summaries of the values actually analyzed (also what the graph shows).
    const cells = Array.from({ length: a }, () => Array.from({ length: b }, () => []));
    used.forEach((u) => u.obs.forEach((o) => cells[o.i][o.j].push(o.y)));
    const cellN = cells.map((row) => row.map((v) => v.length));
    const cellMeans = cells.map((row) => row.map((v) => (v.length ? mean(v) : NaN)));
    const cellSD = cells.map((row) => row.map((v) => (v.length > 1 ? Math.sqrt(variance(v)) : NaN)));
    Object.assign(base, { cells, cellN, cellMeans, cellSD, N: used.reduce((s, u) => s + u.obs.length, 0) });
    if (cellN.some((row) => row.some((n) => n === 0))) {
      return { error: mode === 'rm' && missing
        ? 'After leaving out subjects with a missing value, a combination of ' + factorRow + ' and ' + factorCol + ' has no data.'
        : 'Every combination of ' + factorRow + ' and ' + factorCol + ' needs at least one value.' };
    }
    if (used.length < 2) return { error: 'Repeated measures need at least two subjects' + (mode === 'rm' && missing ? ' with a value in every repeated position.' : '.') };

    // The mixed model: fitted directly, and also the source of the comparisons when
    // the ANOVA assumes sphericity (the two agree when no value is missing).
    const p = a * b;
    const blocks = used.map((u) => ({
      X: u.obs.map((o) => cellRow(o.i, o.j, a, b)), y: u.obs.map((o) => o.y),
      keys: matching === 'both' ? [u.obs.map(() => 0), u.obs.map((o) => o.i), u.obs.map((o) => o.j)] : [u.obs.map(() => 0)],
    }));
    const nTerms = matching === 'both' ? 3 : 1;
    const termNames = matching === 'both' ? ['Subject', factorRow + ' × Subject', factorCol + ' × Subject'] : ['Subject'];
    // The ANOVA needs the fitted model only for its comparisons under assumed sphericity.
    const fit = mode === 'mixed' || opts.sphericity === true ? remlFit(blocks, p, nTerms) : { error: 'not fitted' };
    const L = { row: unitRows(1, a - 1, p), col: unitRows(a, b - 1, p), int: unitRows(a + b - 1, (a - 1) * (b - 1), p) };
    const names = { row: factorRow, col: factorCol, int: interactionName(factorRow, factorCol) };

    if (mode === 'mixed') {
      if (fit.error) return { error: fit.error };
      const effects = ['row', 'col', 'int'].map((key) => { const t = krTest(fit, L[key]); return { key, name: names[key], F: t.F, df1: t.df1, df2: t.df2, p: t.p }; });
      const chi2 = Math.max(0, 2 * (fit.ll - fit.llNoRandom));
      return Object.assign(base, {
        test: 'Mixed-effects model (two-way)', effects,
        random: termNames.map((name, t) => ({ name, variance: fit.theta[t + 1], sd: Math.sqrt(fit.theta[t + 1]) })),
        residual: { variance: fit.theta[0], sd: Math.sqrt(fit.theta[0]) },
        matchingTest: { chi2, df: nTerms, p: C.chiSquareP(chi2, nTerms) },
        boundary: fit.boundary, sphericity: true, _fit: fit, _used: used,
      });
    }

    // Repeated-measures ANOVA on subjects with complete data.
    const sphericity = opts.sphericity === true;
    const grand = mean(used.flatMap((u) => u.obs.map((o) => o.y)));
    const ssTotal = used.reduce((s, u) => s + u.obs.reduce((t, o) => t + (o.y - grand) ** 2, 0), 0);
    const effect = (key, ss, df, ssErr, dfErr, eps, d) => {
      const ms = ss / df, F = ms / (ssErr / dfErr);
      const pAssumed = C.fDistP(F, df, dfErr), within = eps != null;
      const pGG = within ? C.fDistP(F, eps * df, eps * dfErr) : pAssumed;
      const useGG = within && !sphericity;
      return {
        key, name: names[key], ss, df, ms, F, ssError: ssErr, dfError: dfErr, pAssumed, pGG, epsilon: within ? eps : null, contrasts: within ? d : null,
        p: useGG ? pGG : pAssumed, df1: useGG ? eps * df : df, df2: useGG ? eps * dfErr : dfErr, partialEta2: ss / (ss + ssErr),
      };
    };
    let effects, strata;
    if (matching === 'both') {
      const n = used.length, grid2 = used.map((u) => { const m = zeros(a, b); u.obs.forEach((o) => { m[o.i][o.j] = o.y; }); return m; });
      const CA = contrasts(a), CB = contrasts(b), one = new Array(n).fill(0);
      const rowAvg = (m) => m.map((r) => r.reduce((s, v) => s + v, 0) / Math.sqrt(b));
      const colAvg = (m) => m[0].map((_, j) => m.reduce((s, r) => s + r[j], 0) / Math.sqrt(a));
      const zA = grid2.map((m) => mulVec(CA, rowAvg(m)));
      const zB = grid2.map((m) => mulVec(CB, colAvg(m)));
      const zAB = grid2.map((m) => { const out = []; for (const ca of CA) for (const cb of CB) { let s = 0; for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) s += ca[i] * cb[j] * m[i][j]; out.push(s); } return out; });
      const tA = scoreTests(zA, one, 1), tB = scoreTests(zB, one, 1), tAB = scoreTests(zAB, one, 1);
      const subjMeans = grid2.map((m) => mean(m.flat()));
      const ssSubj = a * b * subjMeans.reduce((s, v) => s + (v - grand) ** 2, 0);
      if (!(tAB.ssError > 1e-13 * ssTotal)) return { error: 'No residual variation: every subject changes by exactly the same amount, so F is undefined.' };
      effects = [effect('row', tA.ssAverage, a - 1, tA.ssError, tA.dfError, tA.epsilon, tA.d), effect('col', tB.ssAverage, b - 1, tB.ssError, tB.dfError, tB.epsilon, tB.d),
        effect('int', tAB.ssAverage, (a - 1) * (b - 1), tAB.ssError, tAB.dfError, tAB.epsilon, tAB.d)];
      const stratum = (name, ss, df) => ({ name, ss, df, ms: ss / df });
      strata = [stratum('Subjects (matching)', ssSubj, n - 1), stratum(factorRow + ' × Subjects', tA.ssError, tA.dfError),
        stratum(factorCol + ' × Subjects', tB.ssError, tB.dfError), stratum('Residual', tAB.ssError, tAB.dfError)];
    } else {
      const rowsRepeated = matching === 'rows';
      const k = rowsRepeated ? a : b, g = rowsRepeated ? b : a;       // within levels, between levels
      const ns = new Array(g).fill(0); used.forEach((u) => { ns[u.group]++; });
      if (used.length - g < 1) return { error: 'Repeated-measures ANOVA needs at least two subjects in one of the groups.' };
      const profile = used.map((u) => { const v = new Array(k); u.obs.forEach((o) => { v[rowsRepeated ? o.i : o.j] = o.y; }); return v; });
      const group = used.map((u) => u.group);
      const Ck = contrasts(k);
      const tW = scoreTests(profile.map((v) => mulVec(Ck, v)), group, g);
      const subjMeans = profile.map(mean), gMeans = new Array(g).fill(0);
      subjMeans.forEach((m, s) => { gMeans[group[s]] += m / ns[group[s]]; });
      const ssBetween = k * gMeans.reduce((s, m, j) => s + ns[j] * (m - mean(subjMeans)) ** 2, 0);
      const ssSubj = k * subjMeans.reduce((s, m, i) => s + (m - gMeans[group[i]]) ** 2, 0), dfSubj = used.length - g;
      if (!(tW.ssError > 1e-13 * ssTotal)) return { error: 'No residual variation: every subject changes by exactly the same amount, so F is undefined.' };
      const within = effect(rowsRepeated ? 'row' : 'col', tW.ssAverage, k - 1, tW.ssError, tW.dfError, tW.epsilon, tW.d);
      const between = effect(rowsRepeated ? 'col' : 'row', ssBetween, g - 1, ssSubj, dfSubj, null);
      const inter = effect('int', tW.ssBetween, (k - 1) * (g - 1), tW.ssError, tW.dfError, tW.epsilon, tW.d);
      effects = rowsRepeated ? [within, between, inter] : [between, within, inter];
      const Fm = (ssSubj / dfSubj) / (tW.ssError / tW.dfError);
      strata = [{ name: 'Subjects (matching)', ss: ssSubj, df: dfSubj, ms: ssSubj / dfSubj, F: Fm, p: C.fDistP(Fm, dfSubj, tW.dfError) },
        { name: 'Residual', ss: tW.ssError, df: tW.dfError, ms: tW.ssError / tW.dfError }];
    }
    return Object.assign(base, {
      test: 'Repeated-measures two-way ANOVA', effects, strata, ssTotal, grand, sphericity,
      boundary: !fit.error && fit.boundary, _fit: fit.error ? null : fit, _used: used,
    });
  }

  // Multiple comparisons after twoWayRepeated(). Directions, methods, opts.control and
  // opts.families as in StatTests.twoWayPosthoc. Three ways of forming each comparison:
  //   mixed model, or ANOVA with sphericity assumed: the fitted model's means, the
  //     adjusted covariance of the fixed effects and Kenward–Roger df per comparison;
  //   ANOVA without the sphericity assumption: only the data of the two means compared,
  //     a paired t test when they hold the same subjects and Welch's t test when they
  //     hold different subjects.
  function twoWayRepeatedPosthoc(model, method = 'sidak', direction = 'colsWithinRow', opts = {}) {
    const { a, b, rowNames, colNames, matching, cellN } = model;
    const fit = model._fit, used = model._used;
    const fromModel = model.mode === 'mixed' || model.sphericity;
    const vsControl = method === 'dunnett' || opts.family === 'control';
    const control = opts.control != null ? +opts.control : 0;
    const within = direction === 'colsWithinRow' || direction === 'rowsWithinCol';
    const perBlock = within && (method === 'tukey' || method === 'dunnett' || opts.families === 'each');
    const levelPairs = (count) => {
      const pairs = [];
      if (!vsControl) { for (let x = 0; x < count; x++) for (let y = x + 1; y < count; y++) pairs.push([x, y]); }
      else for (let x = 0; x < count; x++) if (x !== control) pairs.push([x, control]);
      return pairs;
    };
    const rowSet = (i) => Array.from({ length: b }, (_, j) => [i, j]);
    const colSet = (j) => Array.from({ length: a }, (_, i) => [i, j]);
    const wanted = []; // { block, an, bn, A, B, groups, cellA, cellB }
    if (direction === 'colsWithinRow') {
      for (let i = 0; i < a; i++) for (const [j, k] of levelPairs(b)) wanted.push({ block: rowNames[i], an: colNames[j], bn: colNames[k], A: [[i, j]], B: [[i, k]], groups: b, cellA: [i, j], cellB: [i, k] });
    } else if (direction === 'rowsWithinCol') {
      for (let j = 0; j < b; j++) for (const [i, k] of levelPairs(a)) wanted.push({ block: colNames[j], an: rowNames[i], bn: rowNames[k], A: [[i, j]], B: [[k, j]], groups: a, cellA: [i, j], cellB: [k, j] });
    } else if (direction === 'colMeans') {
      for (const [j, k] of levelPairs(b)) wanted.push({ block: '—', an: colNames[j], bn: colNames[k], A: colSet(j), B: colSet(k), groups: b });
    } else if (direction === 'rowMeans') {
      for (const [i, k] of levelPairs(a)) wanted.push({ block: '—', an: rowNames[i], bn: rowNames[k], A: rowSet(i), B: rowSet(k), groups: a });
    } else {
      const flat = []; for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) flat.push([i, j]);
      const pairs = [];
      if (!vsControl) { for (let x = 0; x < flat.length; x++) for (let y = x + 1; y < flat.length; y++) pairs.push([x, y]); }
      else if (control < flat.length) for (let x = 0; x < flat.length; x++) if (x !== control) pairs.push([x, control]);
      for (const [x, y] of pairs) {
        const [i1, j1] = flat[x], [i2, j2] = flat[y];
        wanted.push({ block: '—', an: rowNames[i1] + ' · ' + colNames[j1], bn: rowNames[i2] + ' · ' + colNames[j2], A: [flat[x]], B: [flat[y]], groups: flat.length, cellA: flat[x], cellB: flat[y] });
      }
    }
    const p = a * b;
    const contrastOf = (w) => {
      const Lrow = new Array(p).fill(0);
      w.A.forEach(([i, j]) => cellRow(i, j, a, b).forEach((x, c) => { Lrow[c] += x / w.A.length; }));
      w.B.forEach(([i, j]) => cellRow(i, j, a, b).forEach((x, c) => { Lrow[c] -= x / w.B.length; }));
      return Lrow;
    };
    // Per-subject values for the data-only comparisons.
    const value = used.map((u) => { const m = zeros(a, b); u.obs.forEach((o) => { m[o.i][o.j] = o.y; }); return m; });
    const scoreOf = (s, set) => set.reduce((t, [i, j]) => t + value[s][i][j], 0) / set.length;
    const betweenLevel = (cell) => (matching === 'rows' ? cell[1] : matching === 'cols' ? cell[0] : 0);
    const levelsOf = (set) => [...new Set(set.map(betweenLevel))].sort((x, y) => x - y);
    const subjectsIn = (level) => used.map((u, s) => (matching === 'both' || u.group === level ? s : -1)).filter((s) => s >= 0);
    const dataComparison = (w) => {
      const la = levelsOf(w.A), lb = levelsOf(w.B);
      if (la.join() === lb.join()) {
        // The same subjects on both sides: paired differences, one stratum per group.
        let diff = 0, se2 = 0, dfDen = 0;
        for (const lv of la) {
          const ss = subjectsIn(lv), inLevel = (set) => set.filter((c) => betweenLevel(c) === lv);
          const d = ss.map((s) => scoreOf(s, inLevel(w.A)) - scoreOf(s, inLevel(w.B)));
          if (d.length < 2) return null;
          const v = variance(d) / d.length / (la.length * la.length);
          diff += mean(d) / la.length; se2 += v; dfDen += v * v / (d.length - 1);
        }
        return { diff, se: Math.sqrt(se2), df: la.length === 1 ? subjectsIn(la[0]).length - 1 : se2 * se2 / dfDen };
      }
      if (la.length !== 1 || lb.length !== 1) return null;
      // Different subjects: Welch's t test on each subject's value (or mean) for its side.
      const x = subjectsIn(la[0]).map((s) => scoreOf(s, w.A)), y = subjectsIn(lb[0]).map((s) => scoreOf(s, w.B));
      if (x.length < 2 || y.length < 2) return null;
      const vx = variance(x) / x.length, vy = variance(y) / y.length;
      return { diff: mean(x) - mean(y), se: Math.sqrt(vx + vy), df: (vx + vy) ** 2 / (vx * vx / (x.length - 1) + vy * vy / (y.length - 1)) };
    };
    const comps = [];
    for (const w of wanted) {
      if (w.A.concat(w.B).some(([i, j]) => !cellN[i][j])) continue;
      let c;
      if (fromModel) {
        if (!fit) continue;
        const Lrow = contrastOf(w), t = krTest(fit, [Lrow]);
        if (!t) continue;
        c = { diff: t.estimate, se: t.se, df: t.df2, L: Lrow };
      } else c = dataComparison(w);
      if (!c || !(c.se > 0) || !Number.isFinite(c.diff) || !(c.df > 0)) continue;
      comps.push(Object.assign(c, { within: w.block, a: w.an, b: w.bn, groups: w.groups, cellA: w.cellA, cellB: w.cellB }));
    }
    const blocks = new Map();
    comps.forEach((c) => { const key = perBlock ? c.within : ''; if (!blocks.has(key)) blocks.set(key, []); blocks.get(key).push(c); });
    let approximate = false;
    const calc = method === 'tukey' || method === 'dunnett' || H.ADJUSTMENTS.includes(method) ? method : 'sidak';
    blocks.forEach((block) => {
      const ctx = { k: block[0].groups, ownDf: true, intervals: false };
      if (calc === 'dunnett' && fromModel && block.length > 1) {
        // Correlations between the comparisons of one family, from the fitted model.
        const R = block.map((x, i) => block.map((y, j) => (i === j ? 1 : quad(x.L, fit.PhiA, y.L) / (x.se * y.se))));
        const lam = H.oneFactorLambdas(R);
        ctx.lambdas = lam.lambdas; if (!lam.exact) approximate = true;
      }
      H.finishComparisons(block, calc, ctx);
    });
    comps.forEach((c) => { delete c.L; });
    return {
      method, direction, requestedDirection: direction, control, comparisons: comps, dfError: null, perComparisonDf: true,
      families: within ? (perBlock ? 'each' : 'all') : null, familyCount: blocks.size, approximate,
      basis: fromModel ? 'model' : 'data',
    };
  }

  // ---------- one-way mixed-effects model ----------
  // Each row is one subject, each column one condition; every value present is used.
  function oneWayMixed(rawCols, names) {
    const k = rawCols.length;
    names = names || rawCols.map((_, i) => 'Group ' + (i + 1));
    if (k < 2) return { error: 'The mixed-effects model needs at least two columns.' };
    const len = Math.max(0, ...rawCols.map((c) => c.length));
    const blocks = [], data = rawCols.map(() => []);
    let partial = 0, complete = 0;
    for (let r = 0; r < len; r++) {
      const cols = []; for (let j = 0; j < k; j++) if (isNum(rawCols[j][r])) cols.push(j);
      if (!cols.length) continue;
      if (cols.length < k) partial++; else complete++;
      cols.forEach((j) => data[j].push(Number(rawCols[j][r])));
      blocks.push({ X: cols.map((j) => cellRow(j, 0, k, 1)), y: cols.map((j) => Number(rawCols[j][r])), keys: [cols.map(() => 0)] });
    }
    if (data.some((v) => !v.length)) return { error: 'Every column needs at least one value.' };
    if (blocks.length < 2) return { error: 'The mixed-effects model needs at least two rows with data.' };
    const fit = remlFit(blocks, k, 1);
    if (fit.error) return { error: fit.error };
    const t = krTest(fit, unitRows(1, k - 1, k));
    const means = Array.from({ length: k }, (_, j) => cellRow(j, 0, k, 1).reduce((s, x, c) => s + x * fit.beta[c], 0));
    const chi2 = Math.max(0, 2 * (fit.ll - fit.llNoRandom));
    return {
      test: 'Mixed-effects model (one-way)', k, names, n: blocks.length, N: fit.N, partialRows: partial, completeRows: complete,
      means, rawMeans: data.map(mean), counts: data.map((v) => v.length),
      F: t.F, df1: t.df1, df2: t.df2, p: t.p,
      random: [{ name: 'Subject', variance: fit.theta[1], sd: Math.sqrt(fit.theta[1]) }],
      residual: { variance: fit.theta[0], sd: Math.sqrt(fit.theta[0]) },
      matchingTest: { chi2, df: 1, p: C.chiSquareP(chi2, 1) }, boundary: fit.boundary,
      _fit: fit, _data: data,
    };
  }
  // Comparisons of the model's means; families and methods as in StatTests.rmPosthoc.
  function oneWayMixedPosthoc(mm, method = 'tukey', opts = {}) {
    const { k, names, means } = mm, fit = mm._fit;
    const control = method === 'dunnett' || (method !== 'custom' && opts.family === 'control');
    let calc;
    if (method === 'custom') calc = H.ADJUSTMENTS.includes(opts.correction) ? opts.correction : 'sidak';
    else if (control) calc = method === 'dunnett' || H.ADJUSTMENTS.includes(method) ? method : 'holm-sidak';
    else calc = H.ADJUSTMENTS.includes(method) || method === 'tukey' || method === 'snk' ? method : 'holm-sidak';
    const items = H.comparisonFamily(k, method, opts).map(([i, j]) => {
      const L = cellRow(i, 0, k, 1).map((x, c) => x - cellRow(j, 0, k, 1)[c]), t = krTest(fit, [L]);
      return { i, j, diff: t.estimate, se: t.se, df: t.df2, L };
    });
    const ctx = { k, means, ownDf: true };
    let approximate = false;
    if (calc === 'dunnett' && items.length > 1) {
      const lam = H.oneFactorLambdas(items.map((x, i) => items.map((y, j) => (i === j ? 1 : quad(x.L, fit.PhiA, y.L) / (x.se * y.se)))));
      ctx.lambdas = lam.lambdas; approximate = !lam.exact;
    }
    H.finishComparisons(items, calc, ctx);
    items.forEach((c) => { delete c.L; });
    return { method: method === 'custom' ? 'custom (' + (opts.correction || 'sidak') + ')' : method, comparisons: H.labelComparisons(items, names), approximate };
  }

  // Geisser–Greenhouse epsilon for each repeated effect of a complete-data design, for
  // the guidance shown before the analysis is run; d is the effect's number of
  // contrasts, so epsilon lies between 1/d and 1. Null when it cannot be computed.
  function sphericityPreview(grid, matching) {
    const r = twoWayRepeated(grid, grid.map((_, i) => 'R' + i), grid[0].map((_, j) => 'C' + j), { matching, method: 'rm' });
    if (r.error) return null;
    return r.effects.filter((e) => e.epsilon != null).map((e) => ({ key: e.key, epsilon: e.epsilon, d: e.contrasts }));
  }

  return { twoWayRepeated, twoWayRepeatedPosthoc, oneWayMixed, oneWayMixedPosthoc, subjectLayout, sphericityPreview, _remlFit: remlFit, _krTest: krTest };
})(typeof StatCore !== 'undefined' ? StatCore : require('./stats-core.js'), typeof StatTests !== 'undefined' ? StatTests : require('./stats-tests.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = StatMixed;
