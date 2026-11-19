"""Reference values for tests/anova.check.js.

Not run by `npm test`: the numbers it prints are frozen in tests/anova-reference.json.
Regenerate with `python3 tests/anova-oracle.py > tests/anova-reference.json`
(needs NumPy and SciPy >= 1.16; written against SciPy 1.17.1).

Every value comes from SciPy or from a formulation different from the one in
js/stats-tests.js (adaptive quadrature instead of fixed rules, eigenvalues instead
of Box's sums, least squares instead of closed forms, a brute-force scan instead of
bisection), so agreement is not one implementation checked against itself.
"""
import json
import math

import numpy as np
from scipy import integrate, stats

# Independent groups, unequal n and visibly unequal spread.
G = [
    [22.0, 24.0, 21.0, 25.0, 23.0, 26.0],
    [30.0, 28.0, 31.0, 27.0, 29.0],
    [26.0, 25.0, 27.0, 24.0, 28.0, 30.0, 31.0],
    [35.0, 31.0, 38.0, 29.0],
]
# Balanced groups for the legacy (equicorrelated) Dunnett path.
GB = [[22.0, 24.0, 21.0, 25.0, 23.0], [30.0, 28.0, 31.0, 27.0, 29.0], [26.0, 25.0, 27.0, 24.0, 28.0]]
# Matched rows: 6 subjects x 4 conditions (row 3 has a within-row tie).
RM = [
    [10.0, 12.0, 15.0, 14.0],
    [8.0, 9.0, 13.0, 15.0],
    [11.0, 11.0, 14.0, 13.0],
    [9.0, 13.0, 12.0, 17.0],
    [12.0, 14.0, 18.0, 16.0],
    [7.0, 10.0, 11.0, 15.0],
]
PS = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.5]
# Two-way cells [row][column] with unequal replicates.
TW = [
    [[4.0, 5.0, 6.0], [7.0, 9.0], [10.0, 12.0, 11.0]],
    [[5.0, 7.0], [8.0, 8.5, 10.0], [15.0, 14.0, 17.0, 16.0]],
]


def chi_scale_pdf(u, df):
    """Density of u = sqrt(chi2_df / df)."""
    return math.exp(math.log(2) + (df / 2) * math.log(df / 2) - math.lgamma(df / 2)
                    + (df - 1) * math.log(u) - df * u * u / 2) if u > 0 else 0.0


def smm_sf(x, m, df):
    f = lambda u: chi_scale_pdf(u, df) * (2 * stats.norm.cdf(x * u) - 1) ** m
    val, _ = integrate.quad(f, 0, np.inf, epsabs=1e-13, epsrel=1e-12, limit=400)
    return 1 - val


def dunnett_sf(d, lambdas, df):
    cs = [math.sqrt(1 - l * l) for l in lambdas]

    def inner(u):
        def g(z):
            prod = stats.norm.pdf(z)
            for l, c in zip(lambdas, cs):
                prod *= stats.norm.cdf((d * u + l * z) / c) - stats.norm.cdf((-d * u + l * z) / c)
            return prod
        return integrate.quad(g, -12, 12, epsabs=1e-13, epsrel=1e-12, limit=400)[0]

    val, _ = integrate.quad(lambda u: chi_scale_pdf(u, df) * inner(u), 0, np.inf, epsabs=1e-12, epsrel=1e-11, limit=400)
    return 1 - val


def root(fn, lo, hi):
    from scipy.optimize import brentq
    return brentq(fn, lo, hi, xtol=1e-12)


def welch(a, b):
    va, vb = np.var(a, ddof=1) / len(a), np.var(b, ddof=1) / len(b)
    se = math.sqrt(va + vb)
    df = (va + vb) ** 2 / (va ** 2 / (len(a) - 1) + vb ** 2 / (len(b) - 1))
    return (np.mean(a) - np.mean(b)) / se, df, se


def bky_q(ps):
    """q-values of the two-stage BKY step-up by brute-force scan over Q."""
    ps = np.asarray(ps)
    m = len(ps)
    order = np.sort(ps)

    def rejected(Q):
        q1 = Q / (1 + Q)
        r1 = max([i + 1 for i in range(m) if order[i] <= (i + 1) * q1 / m], default=0)
        if r1 in (0, m):
            return r1
        return max([i + 1 for i in range(m) if order[i] <= (i + 1) * q1 / (m - r1)], default=0)

    grid = np.linspace(0, 1, 200001)
    counts = np.array([rejected(Q) for Q in grid])
    out = []
    for p in ps:
        rank = int(np.sum(order <= p))
        hits = np.nonzero(counts >= rank)[0]
        out.append(float(grid[hits[0]]) if len(hits) else 1.0)
    return out


out = {}
k = len(G)
ns = [len(g) for g in G]
N = sum(ns)
means = [float(np.mean(g)) for g in G]
variances = [float(np.var(g, ddof=1)) for g in G]
grand = float(np.mean(np.concatenate(G)))
ssb = sum(n * (m - grand) ** 2 for n, m in zip(ns, means))
ssw = sum((n - 1) * v for n, v in zip(ns, variances))
dfw = N - k
msw = ssw / dfw
pairs = [(i, j) for i in range(k) for j in range(i + 1, k)]

f, p = stats.f_oneway(*G)
out["anova"] = {"F": float(f), "p": float(p)}
w = stats.f_oneway(*G, equal_var=False)
out["welch"] = {"F": float(w.statistic), "p": float(w.pvalue)}

# Brown-Forsythe F*: for two groups it must equal Welch's t (F* = t^2, same df).
t2, df2, _ = welch(G[0], G[3])
out["bf_two_groups"] = {"F": t2 * t2, "df2": df2, "p": float(2 * stats.t.sf(abs(t2), df2))}
bf_terms = [(1 - n / N) * v for n, v in zip(ns, variances)]
bf_f = ssb / sum(bf_terms)
bf_df2 = 1 / sum((c / sum(bf_terms)) ** 2 / (n - 1) for c, n in zip(bf_terms, ns))
out["bf"] = {"F": bf_f, "df2": bf_df2, "p": float(stats.f.sf(bf_f, k - 1, bf_df2))}

b = stats.bartlett(*G)
out["bartlett"] = {"T": float(b.statistic), "p": float(b.pvalue)}

tk = stats.tukey_hsd(*G)
ci = tk.confidence_interval(0.95)
out["tukey"] = [{"p": float(tk.pvalue[i][j]), "lo": float(ci.low[i][j]), "hi": float(ci.high[i][j])} for i, j in pairs]
gh = stats.tukey_hsd(*G, equal_var=False)
ci = gh.confidence_interval(0.95)
out["games_howell"] = [{"p": float(gh.pvalue[i][j]), "lo": float(ci.low[i][j]), "hi": float(ci.high[i][j])} for i, j in pairs]

# Pooled-variance t for each pair, then the single-step and step-up adjustments.
raw = []
for i, j in pairs:
    se = math.sqrt(msw * (1 / ns[i] + 1 / ns[j]))
    raw.append(float(2 * stats.t.sf(abs(means[i] - means[j]) / se, dfw)))
out["lsd"] = raw
out["fdr_bh"] = [float(v) for v in stats.false_discovery_control(raw, method="bh")]
out["fdr_by"] = [float(v) for v in stats.false_discovery_control(raw, method="by")]
out["ps"] = PS
out["ps_bh"] = [float(v) for v in stats.false_discovery_control(PS, method="bh")]
out["ps_by"] = [float(v) for v in stats.false_discovery_control(PS, method="by")]
out["ps_bky"] = bky_q(PS)

# Newman-Keuls: studentized range over the number of ordered means spanned.
rank = {idx: r for r, idx in enumerate(sorted(range(k), key=lambda i: -means[i]))}
snk = []
for i, j in pairs:
    se = math.sqrt(msw / 2 * (1 / ns[i] + 1 / ns[j]))
    span = abs(rank[i] - rank[j]) + 1
    snk.append({"r": span, "p": float(stats.studentized_range.sf(abs(means[i] - means[j]) / se, span, dfw))})
out["snk"] = snk

# Tamhane T2 and Dunnett T3 on Welch statistics.
t2s, t3s = [], []
m = len(pairs)
for i, j in pairs:
    t, df, se = welch(G[i], G[j])
    praw = float(2 * stats.t.sf(abs(t), df))
    t2s.append({"p": 1 - (1 - praw) ** m, "half": float(stats.t.ppf(1 - (1 - 0.95 ** (1 / m)) / 2, df)) * se})
    t3s.append({"p": smm_sf(abs(t), m, df), "half": root(lambda x: smm_sf(x, m, df) - 0.05, 0.5, 60) * se})
out["tamhane_t2"] = t2s
out["dunnett_t3"] = t3s
out["smm"] = {"sf_2.5_3_10": smm_sf(2.5, 3, 10), "sf_3_6_4.5": smm_sf(3.0, 6, 4.5), "sf_4_3_1.3": smm_sf(4.0, 3, 1.3),
              "crit_3_10": root(lambda x: smm_sf(x, 3, 10) - 0.05, 0.5, 60)}

# Dunnett vs group 0, unequal n: exact product-correlation structure.
lam = [math.sqrt(ns[i] / (ns[i] + ns[0])) for i in range(1, k)]
dn = []
for i in range(1, k):
    se = math.sqrt(msw * (1 / ns[i] + 1 / ns[0]))
    dn.append(dunnett_sf(abs(means[i] - means[0]) / se, lam, dfw))
out["dunnett_unbalanced"] = {"p": dn, "crit": root(lambda d: dunnett_sf(d, lam, dfw) - 0.05, 0.5, 20)}
sd = stats.dunnett(*G[1:], control=G[0], rng=np.random.default_rng(7))
out["dunnett_scipy_qmc"] = [float(v) for v in sd.pvalue]
# Balanced: equicorrelated 0.5.
nb = [len(g) for g in GB]
mswb = sum((len(g) - 1) * np.var(g, ddof=1) for g in GB) / (sum(nb) - 3)
out["dunnett_balanced"] = [dunnett_sf(abs(np.mean(GB[i]) - np.mean(GB[0])) / math.sqrt(mswb * 2 / 5), [math.sqrt(0.5)] * 2, 12) for i in (1, 2)]

# Linear trend: regress every value on its group position.
xs = np.concatenate([[i + 1] * n for i, n in enumerate(ns)])
ys = np.concatenate(G)
lr = stats.linregress(xs, ys)
sst = float(np.sum((ys - grand) ** 2))
ss_trend = lr.rvalue ** 2 * sst
out["trend"] = {"slope": float(lr.slope), "r2": float(lr.rvalue ** 2), "F": ss_trend / msw, "p": float(stats.f.sf(ss_trend / msw, 1, dfw)),
                "Fnl": (ssb - ss_trend) / (k - 2) / msw, "pnl": float(stats.f.sf((ssb - ss_trend) / (k - 2) / msw, k - 2, dfw))}

# Repeated measures by least squares (subject and condition dummies).
Y = np.array(RM)
n, kk = Y.shape


def rss(design):
    beta, *_ = np.linalg.lstsq(design, Y.ravel(), rcond=None)
    return float(np.sum((Y.ravel() - design @ beta) ** 2))


subj = np.kron(np.eye(n), np.ones((kk, 1)))
cond = np.kron(np.ones((n, 1)), np.eye(kk))
full = np.hstack([subj, cond])
ss_res = rss(full)
ss_treat = rss(subj) - ss_res
ss_subj = rss(cond) - ss_res
df_res = (n - 1) * (kk - 1)
F = (ss_treat / (kk - 1)) / (ss_res / df_res)
# Geisser-Greenhouse epsilon from the eigenvalues of the orthonormal-contrast covariance.
helmert = np.linalg.qr(np.hstack([np.ones((kk, 1)), np.eye(kk)[:, :kk - 1]]))[0][:, 1:]
eig = np.linalg.eigvalsh(helmert.T @ np.cov(Y, rowvar=False) @ helmert)
eps = float(eig.sum() ** 2 / ((kk - 1) * np.sum(eig ** 2)))
Fm = (ss_subj / (n - 1)) / (ss_res / df_res)
out["rm"] = {"F": F, "ssTreat": ss_treat, "ssSubj": ss_subj, "ssRes": ss_res, "epsilon": eps,
             "pAssumed": float(stats.f.sf(F, kk - 1, df_res)), "pGG": float(stats.f.sf(F, eps * (kk - 1), eps * df_res)),
             "matchF": Fm, "matchP": float(stats.f.sf(Fm, n - 1, df_res))}
rm_pairs = [(i, j) for i in range(kk) for j in range(i + 1, kk)]
rm_ind, rm_pool = [], []
for i, j in rm_pairs:
    tt = stats.ttest_rel(Y[:, i], Y[:, j])
    rm_ind.append({"t": float(tt.statistic), "pRaw": float(tt.pvalue),
                   "tukey": float(stats.studentized_range.sf(math.sqrt(2) * abs(tt.statistic), kk, n - 1))})
    tp = (Y[:, i].mean() - Y[:, j].mean()) / math.sqrt(2 * ss_res / df_res / n)
    rm_pool.append({"t": float(tp), "pRaw": float(2 * stats.t.sf(abs(tp), df_res)),
                    "tukey": float(stats.studentized_range.sf(math.sqrt(2) * abs(tp), kk, df_res))})
out["rm_individual"] = rm_ind
out["rm_pooled"] = rm_pool
out["rm_dunnett_pooled"] = [dunnett_sf(abs(rm_pool[idx]["t"]), [math.sqrt(0.5)] * (kk - 1), df_res) for idx in (0, 1, 2)]
pt = stats.ttest_rel(Y[:, 0], Y[:, 2])
out["rm_two_columns"] = {"F": float(pt.statistic ** 2), "p": float(pt.pvalue)}

fr = stats.friedmanchisquare(*[Y[:, j] for j in range(kk)])
ranks = np.array([stats.rankdata(r) for r in Y])
rs = ranks.sum(axis=0)
out["friedman"] = {"Q": float(fr.statistic), "p": float(fr.pvalue), "rankSums": [float(v) for v in rs],
                   "dunn": [float(2 * stats.norm.sf(abs(rs[i] - rs[j]) / math.sqrt(n * kk * (kk + 1) / 6))) for i, j in rm_pairs]}

# Kruskal-Wallis Dunn z (tie-corrected) for the control family.
allv = np.concatenate(G)
rk = stats.rankdata(allv)
offs = np.cumsum([0] + ns)
mr = [float(rk[offs[i]:offs[i + 1]].mean()) for i in range(k)]
_, counts = np.unique(allv, return_counts=True)
sig2 = N * (N + 1) / 12 - float(np.sum(counts ** 3 - counts)) / (12 * (N - 1))
out["dunn_control"] = [float(2 * stats.norm.sf(abs(mr[i] - mr[0]) / math.sqrt(sig2 * (1 / ns[i] + 1 / ns[0])))) for i in range(1, k)]

# Two-way, main effects only (dummy-coded least squares) and Dunnett within row 2.
rows_, cols_, vals_ = [], [], []
for i, row in enumerate(TW):
    for j, cell in enumerate(row):
        for v in cell:
            rows_.append(i); cols_.append(j); vals_.append(v)
vals_ = np.array(vals_)


def rss2(use_rows, use_cols):
    parts = [np.ones((len(vals_), 1))]
    if use_rows:
        parts.append(np.array([[1.0 if r == 1 else 0.0] for r in rows_]))
    if use_cols:
        parts.append(np.array([[1.0 if c == 1 else 0.0, 1.0 if c == 2 else 0.0] for c in cols_]))
    X = np.hstack(parts)
    beta, *_ = np.linalg.lstsq(X, vals_, rcond=None)
    return float(np.sum((vals_ - X @ beta) ** 2))


rss_add = rss2(True, True)
df_add = len(vals_) - 4
out["twoway_additive"] = {"ssRow": rss2(False, True) - rss_add, "ssCol": rss2(True, False) - rss_add, "ssRes": rss_add, "df": df_add,
                          "pRow": float(stats.f.sf((rss2(False, True) - rss_add) / (rss_add / df_add), 1, df_add)),
                          "pCol": float(stats.f.sf((rss2(True, False) - rss_add) / 2 / (rss_add / df_add), 2, df_add))}
cell_ss = sum(float(np.sum((np.array(c) - np.mean(c)) ** 2)) for row in TW for c in row)
df_full = len(vals_) - 6
mse = cell_ss / df_full
row = TW[1]
lam2 = [math.sqrt(len(row[j]) / (len(row[j]) + len(row[0]))) for j in (1, 2)]
out["twoway_dunnett_row2"] = [dunnett_sf(abs(np.mean(row[j]) - np.mean(row[0])) / math.sqrt(mse * (1 / len(row[j]) + 1 / len(row[0]))), lam2, df_full) for j in (1, 2)]

print(json.dumps(out, indent=1))
