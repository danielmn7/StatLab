# Reference values for tests/anova.check.js taken from released R packages.
# Not part of `npm test` (needs R); the output is frozen in anova-reference-r.json.
#
#   STATLAB_RLIB=/path/to/library Rscript tests/anova-reference.R
#
# Packages: stats, car, emmeans, multcomp, mvtnorm, onewaytests, PMCMRplus, jsonlite.
# Each value records the function that produced it in `source`. "COMPOSED" marks a
# value put together from library pieces rather than returned by one function.
lib <- Sys.getenv("STATLAB_RLIB")
if (nzchar(lib)) .libPaths(c(lib, .libPaths()))
suppressPackageStartupMessages({
  library(car); library(emmeans); library(multcomp); library(mvtnorm)
  library(onewaytests); library(PMCMRplus); library(jsonlite)
})
options(contrasts = c("contr.sum", "contr.poly"))
set.seed(20261119)
out <- list(versions = list(R = R.version.string))
for (p in c("car", "emmeans", "multcomp", "mvtnorm", "onewaytests", "PMCMRplus")) out$versions[[p]] <- as.character(packageVersion(p))
tight <- GenzBretz(maxpts = 2e6, abseps = 1e-7)

# ---- fixtures (the same numbers as tests/anova.check.js) ----
G <- list(c(22, 24, 21, 25, 23, 26), c(30, 28, 31, 27, 29), c(26, 25, 27, 24, 28, 30, 31), c(35, 31, 38, 29))
one <- data.frame(y = unlist(G), g = factor(rep(paste0("G", 1:4), lengths(G))), x = rep(1:4, lengths(G)))
RM <- rbind(c(10, 12, 15, 14), c(8, 9, 13, 15), c(11, 11, 14, 13), c(9, 13, 12, 17), c(12, 14, 18, 16), c(7, 10, 11, 15))
colnames(RM) <- c("A", "B", "C", "D")
rownames(RM) <- paste0("S", 1:nrow(RM))
long <- data.frame(y = as.vector(RM), cond = factor(rep(colnames(RM), each = nrow(RM))), subj = factor(rep(1:nrow(RM), ncol(RM))))
cells_frame <- function(cells) {
  rows <- list()
  for (i in seq_along(cells)) for (j in seq_along(cells[[i]])) {
    v <- cells[[i]][[j]]
    if (length(v)) rows[[length(rows) + 1]] <- data.frame(y = v, R = paste0("R", i), C = paste0("C", j))
  }
  d <- do.call(rbind, rows); d$R <- factor(d$R); d$C <- factor(d$C); d$cell <- factor(paste(d$R, d$C)); d
}
TW <- list(list(c(4, 5, 6), c(7, 9), c(10, 12, 11)), list(c(5, 7), c(8, 8.5, 10), c(15, 14, 17, 16)))
TW5 <- list(
  list(c(4, 5, 6), c(7, 9), c(10, 12, 11), c(6, 8, 7, 9), c(5, 6.5)),
  list(c(5, 7), c(8, 8.5, 10), c(15, 14, 17, 16), c(9), c(7, 8, 6, 7.5, 9)),
  list(c(6, 6.5, 8, 7), c(11), c(12, 15), c(10, 12, 11), c(8)))
pairs_idx <- function(k) { o <- list(); for (i in 1:(k - 1)) for (j in (i + 1):k) o[[length(o) + 1]] <- c(i, j); o }

# ---- Brown–Forsythe ANOVA, 3+ groups ----
bf <- bf.test(y ~ g, data = one, verbose = FALSE)
out$bf <- list(F = unname(bf$statistic), df2 = unname(bf$parameter[2]), p = bf$p.value, source = "onewaytests::bf.test")

# ---- test for linear trend ----
tr <- anova(lm(y ~ x + g, data = one))
out$trend <- list(F = tr["x", "F value"], p = tr["x", "Pr(>F)"], Fnl = tr["g", "F value"], pnl = tr["g", "Pr(>F)"],
  slope = unname(coef(lm(y ~ x, data = one))[2]), ssTrend = tr["x", "Sum Sq"],
  source = "stats::anova(lm(y ~ position + group)), sequential SS against the within-group mean square")

# ---- Newman–Keuls, Tamhane T2 ----
flat <- function(m, k) sapply(pairs_idx(k), function(ij) m[ij[2] - 1, ij[1]])
out$snk <- list(p = flat(snkTest(y ~ g, data = one)$p.value, 4), source = "PMCMRplus::snkTest")
out$tamhane_t2 <- list(p = flat(tamhaneT2Test(y ~ g, data = one)$p.value, 4), source = "PMCMRplus::tamhaneT2Test")

# ---- studentized maximum modulus and Dunnett T3 ----
smm <- function(x, m, df) 1 - as.numeric(pmvt(lower = rep(-x, m), upper = rep(x, m), df = df, corr = diag(m), algorithm = tight))
out$smm <- list("sf_2.5_3_10" = smm(2.5, 3, 10), "sf_3_6_4" = smm(3, 6, 4), "sf_3_6_5" = smm(3, 6, 5), "sf_4_3_2" = smm(4, 3, 2),
  source = "mvtnorm::pmvt(corr = diag(m)) [MC]")
# PMCMRplus::dunnettT3Test rounds the Welch df, and pmvt needs whole df, so the
# reference brackets each pair: the p-value at the df rounded down and rounded up.
out$dunnett_t3 <- lapply(pairs_idx(4), function(ij) {
  w <- t.test(G[[ij[1]]], G[[ij[2]]], var.equal = FALSE)
  t <- abs(unname(w$statistic)); df <- unname(w$parameter)
  list(t = t, df = df, pFloor = smm(t, 6, floor(df)), pCeil = smm(t, 6, ceiling(df)))
})
out$dunnett_t3_source <- "COMPOSED: stats::t.test (Welch t, df) + mvtnorm::pmvt at whole df either side [MC]"
out$dunnett_t3_pmcmr <- list(p = flat(dunnettT3Test(y ~ g, data = one)$p.value, 4), source = "PMCMRplus::dunnettT3Test (rounds df) [MC]")

# ---- Dunnett with unequal group sizes ----
dn <- summary(glht(aov(y ~ g, data = one), linfct = mcp(g = "Dunnett")), test = adjusted("single-step", maxpts = 2e6, abseps = 1e-7))
out$dunnett_unbalanced <- list(p = as.numeric(dn$test$pvalues), source = "multcomp::glht(mcp(Dunnett)) single-step [MC]")

# ---- Dunn vs control after Kruskal-Wallis (uncorrected) ----
out$dunn_control <- list(p = as.numeric(kwManyOneDunnTest(y ~ g, data = one, p.adjust.method = "none")$p.value),
  source = "PMCMRplus::kwManyOneDunnTest(p.adjust.method = 'none')")

# ---- repeated-measures one-way ANOVA ----
idata <- data.frame(cond = factor(colnames(RM)))
rm <- summary(Anova(lm(RM ~ 1), idata = idata, idesign = ~cond, type = 3), multivariate = FALSE)
uni <- rm$univariate.tests
blocked <- anova(lm(y ~ cond + subj, data = long))
out$rm <- list(F = uni["cond", "F value"], ssTreat = uni["cond", "Sum Sq"], ssRes = uni["cond", "Error SS"], pAssumed = uni["cond", "Pr(>F)"],
  epsilon = rm$pval.adjustments["cond", "GG eps"], pGG = rm$pval.adjustments["cond", "Pr(>F[GG])"],
  ssSubj = blocked["subj", "Sum Sq"], matchF = blocked["subj", "F value"], matchP = blocked["subj", "Pr(>F)"],
  source = "car::Anova(idata, idesign) univariate tests and GG epsilon; stats::anova(lm(y ~ cond + subj)) for the subject row")
out$rm_individual <- lapply(pairs_idx(4), function(ij) {
  w <- t.test(RM[, ij[1]], RM[, ij[2]], paired = TRUE)
  list(t = unname(w$statistic), pRaw = w$p.value, tukey = ptukey(abs(unname(w$statistic)) * sqrt(2), 4, nrow(RM) - 1, lower.tail = FALSE))
})
out$rm_individual_source <- "stats::t.test(paired = TRUE); Tukey p COMPOSED with stats::ptukey"
pooled <- emmeans(lm(y ~ cond + subj, data = long), ~cond)
pp <- as.data.frame(pairs(pooled, adjust = "tukey"))
out$rm_pooled <- list(t = pp$t.ratio, tukey = pp$p.value, source = "emmeans::pairs(adjust = 'tukey') on lm(y ~ cond + subj)")
single <- function(model, ...) as.numeric(summary(glht(model, linfct = mcp(...)), test = adjusted("single-step", maxpts = 2e6, abseps = 1e-7))$test$pvalues)
out$rm_dunnett_pooled <- list(p = single(lm(y ~ cond + subj, data = long), cond = "Dunnett"), source = "multcomp::glht(mcp(Dunnett)) single-step on lm(y ~ cond + subj) [MC]")

# ---- Friedman and Dunn's comparisons after it ----
fr <- friedman.test(RM)
out$friedman <- list(Q = unname(fr$statistic), p = fr$p.value,
  dunn = flat(frdAllPairsSiegelTest(RM, p.adjust.method = "none")$p.value, 4),
  source = "stats::friedman.test; PMCMRplus::frdAllPairsSiegelTest(p.adjust.method = 'none')")

# ---- two-way ANOVA ----
two_way <- function(cells, key) {
  d <- cells_frame(cells); a <- nlevels(d$R); b <- nlevels(d$C)
  add <- lm(y ~ R + C, data = d); full <- lm(y ~ R * C, data = d)
  t3 <- Anova(add, type = 3)
  res <- list(additive = list(ssRow = t3["R", "Sum Sq"], ssCol = t3["C", "Sum Sq"], ssRes = t3["Residuals", "Sum Sq"], df = t3["Residuals", "Df"],
    pRow = t3["R", "Pr(>F)"], pCol = t3["C", "Pr(>F)"], source = "car::Anova(lm(y ~ R + C), type = 3)"))
  # Main-effect comparisons of a model without an interaction: estimated marginal means.
  emm_side <- function(spec, name) {
    e <- emmeans(add, spec); s <- as.data.frame(e)
    grab <- function(adjust) as.data.frame(pairs(e, adjust = adjust))$p.value
    raw <- as.data.frame(pairs(e, adjust = "none"))
    k <- nrow(s); last <- k
    ctl <- as.data.frame(contrast(e, "trt.vs.ctrl", ref = last, adjust = "none"))
    K <- list(contrMat(table(d[[name]]), type = "Dunnett", base = last)); names(K) <- name
    exact <- as.numeric(summary(glht(add, linfct = do.call(mcp, K)), test = adjusted("single-step", maxpts = 2e6, abseps = 1e-7))$test$pvalues)
    list(means = s$emmean, diff = raw$estimate, se = raw$SE, df = raw$df[1], lsd = raw$p.value, tukey = grab("tukey"),
      sidak = grab("sidak"), bonferroni = grab("bonferroni"), dunnettLast = exact, dunnettLastDiff = ctl$estimate)
  }
  res$emm <- list(col = emm_side(~C, "C"), row = emm_side(~R, "R"),
    source = "emmeans::emmeans / pairs on lm(y ~ R + C); Dunnett vs the last level: multcomp::glht(mcp(Dunnett contrasts)) single-step [MC]")
  # Simple effects of the interaction model: one family per row, or one family for all.
  by_row <- pairs(emmeans(full, ~C | R))
  per <- function(adjust) as.data.frame(summary(by_row, adjust = adjust))$p.value
  all <- function(adjust) as.data.frame(summary(by_row, by = NULL, adjust = adjust))$p.value
  by_col <- pairs(emmeans(full, ~R | C))
  res$families <- list(raw = per("none"), sidakEach = per("sidak"), bonferroniEach = per("bonferroni"), tukeyEach = per("tukey"),
    sidakAll = all("sidak"), bonferroniAll = all("bonferroni"),
    rowsRaw = as.data.frame(summary(by_col, adjust = "none"))$p.value,
    rowsSidakEach = as.data.frame(summary(by_col, adjust = "sidak"))$p.value,
    rowsSidakAll = as.data.frame(summary(by_col, by = NULL, adjust = "sidak"))$p.value,
    source = "emmeans::pairs(emmeans(lm(y ~ R * C), ~ C | R)), summary(adjust =, by = NULL for one family)")
  res
}
out$twoway <- two_way(TW, "TW")
out$twoway5 <- two_way(TW5, "TW5")
# Dunnett within row 2 of the interaction model (cell-means model, explicit contrasts).
d <- cells_frame(TW); cm <- lm(y ~ 0 + cell, data = d)
K <- rbind("R2 C2 - R2 C1" = c(0, 0, 0, -1, 1, 0), "R2 C3 - R2 C1" = c(0, 0, 0, -1, 0, 1))
out$twoway_dunnett_row2 <- list(p = as.numeric(summary(glht(cm, linfct = K), test = adjusted("single-step", maxpts = 2e6, abseps = 1e-7))$test$pvalues),
  source = "multcomp::glht on lm(y ~ 0 + cell) single-step [MC]")

here <- sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))
target <- file.path(if (length(here)) dirname(here) else ".", "anova-reference-r.json")
writeLines(toJSON(out, digits = NA, auto_unbox = TRUE, pretty = TRUE), target)
cat("wrote", target, "\n")
