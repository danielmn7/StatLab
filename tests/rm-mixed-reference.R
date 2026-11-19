# Reference values for tests/rm-mixed.check.js taken from released R packages.
# Not part of `npm test` (needs R); the output is frozen in rm-mixed-reference.json.
#
#   STATLAB_RLIB=/path/to/library Rscript tests/rm-mixed-reference.R
#
# Packages: stats, car, lme4, lmerTest, pbkrtest, emmeans, jsonlite.
# Each block records the function that produced it in `source`. "COMPOSED" marks a
# value put together from library pieces rather than returned by one function.
lib <- Sys.getenv("STATLAB_RLIB")
if (nzchar(lib)) .libPaths(c(lib, .libPaths()))
suppressPackageStartupMessages({ library(car); library(lme4); library(lmerTest); library(pbkrtest); library(emmeans); library(jsonlite) })
options(contrasts = c("contr.sum", "contr.poly"))
emm_options(lmer.df = "kenward-roger", pbkrtest.limit = 1e5)
args <- commandArgs(trailingOnly = FALSE)
here <- dirname(sub("^--file=", "", args[grep("^--file=", args)]))
fx <- fromJSON(file.path(here, "rm-mixed-fixtures.json"), simplifyVector = FALSE)
out <- list(versions = list(R = R.version.string))
for (p in c("car", "lme4", "lmerTest", "pbkrtest", "emmeans")) out$versions[[p]] <- as.character(packageVersion(p))
tight <- lmerControl(optimizer = "nloptwrap", optCtrl = list(xtol_abs = 1e-12, ftol_abs = 1e-14, maxeval = 1e5), check.conv.singular = "ignore")

long_of <- function(grid, matching) {
  rows <- list()
  for (i in seq_along(grid)) for (j in seq_along(grid[[i]])) for (s in seq_along(grid[[i]][[j]])) {
    v <- grid[[i]][[j]][[s]]
    if (is.null(v)) next
    subj <- switch(matching, rows = paste0("g", j, "s", s), cols = paste0("r", i, "s", s), both = paste0("s", s))
    rows[[length(rows) + 1]] <- data.frame(y = v, R = paste0("R", i), C = paste0("C", j), S = subj)
  }
  d <- do.call(rbind, rows)
  d$R <- factor(d$R, levels = paste0("R", seq_along(grid))); d$C <- factor(d$C, levels = paste0("C", seq_along(grid[[1]]))); d$S <- factor(d$S); d
}
complete_only <- function(d, matching, a, b) {
  need <- switch(matching, rows = a, cols = b, both = a * b)
  keep <- names(which(table(d$S) == need)); d <- d[d$S %in% keep, ]; d$S <- factor(d$S); d
}
pairs_frame <- function(emm) { s <- as.data.frame(pairs(emm, adjust = "none")); lapply(seq_len(nrow(s)), function(k) list(label = paste(unlist(lapply(s[k, !(names(s) %in% c("estimate", "SE", "df", "t.ratio", "p.value")), drop = FALSE], as.character)), collapse = " | "), diff = s$estimate[k], se = s$SE[k], df = s$df[k], t = s$t.ratio[k], p = s$p.value[k])) }

# Repeated-measures ANOVA: univariate tests and Geisser-Greenhouse epsilon from the
# multivariate linear model (car::Anova with idata/idesign, Type III).
rm_anova <- function(d, matching, a, b) {
  d$cell <- interaction(d$R, d$C, sep = ".")
  if (matching == "both") {
    Y <- tapply(d$y, list(d$S, d$cell), identity)
    Y <- matrix(as.numeric(Y), nrow = nrow(Y), dimnames = dimnames(Y))
    idata <- expand.grid(R = levels(d$R), C = levels(d$C))
    fit <- lm(Y ~ 1)
    an <- Anova(fit, idata = idata, idesign = ~R * C, type = 3)
    map <- c(row = "R", col = "C", int = "R:C")
  } else {
    w <- if (matching == "rows") "R" else "C"; g <- if (matching == "rows") "C" else "R"
    Y <- tapply(d$y, list(d$S, d[[w]]), identity)
    Y <- matrix(as.numeric(Y), nrow = nrow(Y), dimnames = dimnames(Y))
    G <- factor(tapply(as.character(d[[g]]), d$S, function(x) x[1]), levels = levels(d[[g]]))
    idata <- data.frame(W = factor(levels(d[[w]]), levels = levels(d[[w]])))
    fit <- lm(Y ~ G)
    an <- Anova(fit, idata = idata, idesign = ~W, type = 3)
    map <- if (matching == "rows") c(row = "W", col = "G", int = "G:W") else c(row = "G", col = "W", int = "G:W")
  }
  s <- summary(an, multivariate = FALSE)
  u <- s$univariate.tests; adj <- s$pval.adjustments
  res <- list()
  for (key in names(map)) {
    term <- map[[key]]
    e <- list(ss = u[term, "Sum Sq"], df = u[term, "num Df"], ssError = u[term, "Error SS"], dfError = u[term, "den Df"], F = u[term, "F value"], pAssumed = u[term, "Pr(>F)"])
    if (!is.null(adj) && term %in% rownames(adj)) { e$epsilon <- adj[term, "GG eps"]; e$pGG <- adj[term, "Pr(>F[GG])"] }
    res[[key]] <- e
  }
  res
}
mixed_fit <- function(d, matching) {
  f <- if (matching == "both") y ~ R * C + (1 | S) + (1 | S:R) + (1 | S:C) else y ~ R * C + (1 | S)
  m <- lmer(f, data = d, REML = TRUE, control = tight)
  an <- anova(m, ddf = "Kenward-Roger", type = 3)
  vc <- as.data.frame(VarCorr(m))
  eff <- function(term) list(F = an[term, "F value"], df1 = an[term, "NumDF"], df2 = an[term, "DenDF"], p = an[term, "Pr(>F)"])
  v <- function(grp) vc$vcov[vc$grp == grp]
  ll0 <- as.numeric(logLik(lm(y ~ R * C, data = d), REML = TRUE))
  list(effects = list(row = eff("R"), col = eff("C"), int = eff("R:C")),
       variance = c(list(residual = v("Residual"), subject = v("S")), if (matching == "both") list(subjectRow = v("S:R"), subjectCol = v("S:C"))),
       logLik = as.numeric(logLik(m)), matchingChi2 = 2 * (as.numeric(logLik(m)) - ll0),
       colsWithinRow = pairs_frame(emmeans(m, ~C | R)), rowsWithinCol = pairs_frame(emmeans(m, ~R | C)),
       colMeans = pairs_frame(emmeans(m, ~C)), rowMeans = pairs_frame(emmeans(m, ~R)))
}

for (name in names(fx)) {
  f <- fx[[name]]
  if (!is.null(f$rows)) {
    rows <- list()
    for (r in seq_along(f$rows)) for (j in seq_along(f$rows[[r]])) { v <- f$rows[[r]][[j]]; if (!is.null(v)) rows[[length(rows) + 1]] <- data.frame(y = v, cond = paste0("K", j), subj = paste0("s", r)) }
    d <- do.call(rbind, rows); d$cond <- factor(d$cond); d$subj <- factor(d$subj)
    m <- lmer(y ~ cond + (1 | subj), data = d, REML = TRUE, control = tight)
    an <- anova(m, ddf = "Kenward-Roger", type = 3); vc <- as.data.frame(VarCorr(m))
    out[[name]] <- list(
      source = "lmerTest::anova(lmer, ddf = 'Kenward-Roger', type = 3); lme4::VarCorr; emmeans::pairs(lmer.df = 'kenward-roger'); matchingChi2 COMPOSED: 2 * (logLik(lmer) - logLik(lm, REML = TRUE))",
      F = an["cond", "F value"], df1 = an["cond", "NumDF"], df2 = an["cond", "DenDF"], p = an["cond", "Pr(>F)"],
      variance = list(residual = vc$vcov[vc$grp == "Residual"], subject = vc$vcov[vc$grp == "subj"]),
      matchingChi2 = 2 * (as.numeric(logLik(m)) - as.numeric(logLik(lm(y ~ cond, data = d), REML = TRUE))),
      means = as.data.frame(emmeans(m, ~cond))$emmean, pairs = pairs_frame(emmeans(m, ~cond)))
    next
  }
  a <- length(f$grid); b <- length(f$grid[[1]])
  d <- long_of(f$grid, f$matching)
  dc <- complete_only(d, f$matching, a, b)
  entry <- list(
    source = "rm: car::Anova(lm(cbind ~ between), idata, idesign, type = 3) univariate tests and GG eps, on subjects with complete data; mixed: lmerTest::anova(lmer, ddf = 'Kenward-Roger', type = 3), lme4::VarCorr, emmeans::pairs(lmer.df = 'kenward-roger'); matchingChi2 COMPOSED: 2 * (logLik(lmer) - logLik(lm, REML = TRUE))",
    subjects = nlevels(d$S), subjectsComplete = nlevels(dc$S),
    rm = rm_anova(dc, f$matching, a, b), mixed = mixed_fit(d, f$matching), mixedComplete = mixed_fit(dc, f$matching))
  # Comparisons without the sphericity assumption: stats::t.test on the two means' own data.
  if (f$matching != "both") {
    w <- if (f$matching == "rows") "R" else "C"; g <- if (f$matching == "rows") "C" else "R"
    wl <- levels(dc[[w]]); gl <- levels(dc[[g]])
    in1 <- dc[dc[[g]] == gl[1], ]
    x <- in1$y[in1[[w]] == wl[1]][order(in1$S[in1[[w]] == wl[1]])]; y <- in1$y[in1[[w]] == wl[2]][order(in1$S[in1[[w]] == wl[2]])]
    tp <- t.test(x, y, paired = TRUE)
    at1 <- dc[dc[[w]] == wl[1], ]
    tw <- t.test(at1$y[at1[[g]] == gl[1]], at1$y[at1[[g]] == gl[2]], var.equal = FALSE)
    sm <- tapply(dc$y, dc$S, mean); sg <- tapply(as.character(dc[[g]]), dc$S, function(z) z[1])
    tm <- t.test(sm[sg == gl[1]], sm[sg == gl[2]], var.equal = FALSE)
    entry$data <- list(source = "stats::t.test: paired within the first between-level (within levels 1 vs 2); Welch at within level 1 (between levels 1 vs 2); Welch on subject means (between levels 1 vs 2)",
      paired = list(diff = unname(tp$estimate), t = unname(tp$statistic), df = unname(tp$parameter), p = tp$p.value),
      welchCell = list(diff = unname(tw$estimate[1] - tw$estimate[2]), t = unname(tw$statistic), df = unname(tw$parameter), p = tw$p.value),
      welchMarginal = list(diff = unname(tm$estimate[1] - tm$estimate[2]), t = unname(tm$statistic), df = unname(tm$parameter), p = tm$p.value))
  } else {
    x <- dc$y[dc$R == "R1" & dc$C == "C1"][order(dc$S[dc$R == "R1" & dc$C == "C1"])]; y <- dc$y[dc$R == "R1" & dc$C == "C2"][order(dc$S[dc$R == "R1" & dc$C == "C2"])]
    tp <- t.test(x, y, paired = TRUE)
    mr <- tapply(dc$y, list(dc$S, dc$R), mean); tr <- t.test(mr[, 1], mr[, 2], paired = TRUE)
    entry$data <- list(source = "stats::t.test(paired = TRUE): cell R1·C1 vs R1·C2; subject means of R1 vs R2",
      paired = list(diff = unname(tp$estimate), t = unname(tp$statistic), df = unname(tp$parameter), p = tp$p.value),
      pairedMarginal = list(diff = unname(tr$estimate), t = unname(tr$statistic), df = unname(tr$parameter), p = tr$p.value))
  }
  out[[name]] <- entry
}
writeLines(toJSON(out, auto_unbox = TRUE, digits = 15, pretty = TRUE, null = "null"), file.path(here, "rm-mixed-reference.json"))
cat("wrote rm-mixed-reference.json\n")
