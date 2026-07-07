/*
 * guidance.js — Test-selection decision tree + per-test reference guidance.
 * Pure data + helpers; rendered by app.js. Exposes global `Guidance`.
 */
const Guidance = (function () {
  'use strict';

  // Decision tree. Each node is either a question (q + opts) or a recommendation (rec).
  const NODES = {
    q_goal: {
      q: 'What do you want to find out?',
      opts: [
        { ico: '⚖️', label: 'Compare groups or conditions', sub: 'Is there a difference between means/medians?', next: 'q_ngroups' },
        { ico: '📈', label: 'Relationship between two variables', sub: 'Do X and Y move together? Fit a line?', next: 'q_relation' },
        { ico: '⏱️', label: 'Survival / time-to-event', sub: 'Compare time until an event happens', next: 'rec_survival' },
        { ico: '🔍', label: 'Check data quality', sub: 'Test normality or screen for outliers', next: 'q_quality' },
      ],
    },
    q_ngroups: {
      q: 'How are your groups structured?',
      opts: [
        { ico: '1️⃣', label: 'One group vs a fixed value', sub: 'e.g. is the mean different from 100?', next: 'q_one_normal' },
        { ico: '2️⃣', label: 'Two groups, one factor', sub: 'e.g. control vs treated', next: 'q_two_design' },
        { ico: '3️⃣', label: 'Three or more groups, one factor', sub: 'e.g. several doses', next: 'q_many_design' },
        { ico: '🔲', label: 'Two factors at once (grouped)', sub: 'e.g. genotype × time — each combination has replicates', next: 'rec_twoway' },
      ],
    },
    // one sample
    q_one_normal: {
      q: 'Are the data roughly normally distributed?',
      hint: 'Not sure? Run a normality test first — there is a button below.',
      opts: [
        { ico: '✅', label: 'Yes (or n is large)', sub: 'Bell-shaped, no strong skew', next: 'rec_onesample_t' },
        { ico: '❌', label: 'No / small & skewed', sub: 'Use a rank-based test', next: 'rec_wilcoxon_one' },
      ],
    },
    // two groups
    q_two_design: {
      q: 'Are the two groups independent or paired?',
      hint: 'Paired = each value in group 1 is matched to a specific value in group 2 (same subject before/after, littermates, etc.).',
      opts: [
        { ico: '↔️', label: 'Independent (unpaired)', sub: 'Different, unrelated subjects', next: 'q_two_normal' },
        { ico: '🔗', label: 'Paired / matched', sub: 'Same subjects or matched pairs', next: 'q_two_paired_normal' },
      ],
    },
    q_two_normal: {
      q: 'Are the data in each group roughly normal?',
      opts: [
        { ico: '✅', label: 'Yes — both groups', sub: 'Compare means with a t test', next: 'q_two_var' },
        { ico: '❌', label: 'No / ordinal / small', sub: 'Compare ranks instead', next: 'rec_mannwhitney' },
      ],
    },
    q_two_var: {
      q: 'Can you assume equal variances (similar spread)?',
      hint: "When unsure, Welch's correction is the safer default and is rarely wrong.",
      opts: [
        { ico: '🟰', label: 'Yes, similar spread', sub: "Student's pooled t test", next: 'rec_student_t' },
        { ico: '↕️', label: 'No / not sure', sub: "Welch's unequal-variance t test", next: 'rec_welch_t' },
      ],
    },
    q_two_paired_normal: {
      q: 'Are the differences (pair-by-pair) roughly normal?',
      opts: [
        { ico: '✅', label: 'Yes', sub: 'Paired t test', next: 'rec_paired_t' },
        { ico: '❌', label: 'No / ordinal', sub: 'Wilcoxon matched-pairs', next: 'rec_wilcoxon_paired' },
      ],
    },
    // many groups
    q_many_design: {
      q: 'Are the groups independent or repeated/matched?',
      opts: [
        { ico: '↔️', label: 'Independent groups', sub: 'Different subjects per group', next: 'q_many_normal' },
        { ico: '🔗', label: 'Repeated / matched', sub: 'Same subjects across conditions', next: 'rec_rm_note' },
      ],
    },
    q_many_normal: {
      q: 'Are the data roughly normal in each group?',
      opts: [
        { ico: '✅', label: 'Yes', sub: 'One-way ANOVA + post-hoc tests', next: 'rec_anova' },
        { ico: '❌', label: 'No / ordinal', sub: "Kruskal-Wallis + Dunn's", next: 'rec_kruskal' },
      ],
    },
    q_relation: {
      q: 'Do you want a correlation or to fit/predict a line?',
      opts: [
        { ico: '🔵', label: 'Strength of association', sub: 'Correlation coefficient (r or ρ)', next: 'q_corr_normal' },
        { ico: '📉', label: 'Fit a line / predict Y from X', sub: 'Linear regression', next: 'rec_regression' },
      ],
    },
    q_corr_normal: {
      q: 'Linear relationship with roughly normal data?',
      opts: [
        { ico: '✅', label: 'Yes', sub: 'Pearson correlation', next: 'rec_pearson' },
        { ico: '❌', label: 'No / monotonic / ranks', sub: 'Spearman correlation', next: 'rec_spearman' },
      ],
    },
    q_quality: {
      q: 'What do you want to check?',
      opts: [
        { ico: '🔔', label: 'Is my data normal?', sub: 'Normality tests', next: 'rec_normality' },
        { ico: '🎯', label: 'Are there outliers?', sub: "Grubbs' test", next: 'rec_grubbs' },
      ],
    },

    // ----- recommendations -----
    rec_onesample_t: rec('One-sample t test', 'onesample-t', {}, 'Compares the mean of one sample to a hypothetical value you specify.'),
    rec_wilcoxon_one: rec('Wilcoxon signed-rank (one sample)', 'wilcoxon', { oneSample: true }, 'Rank-based alternative to the one-sample t test; tests whether the median differs from a value.'),
    rec_student_t: rec("Unpaired t test (Student's)", 'unpaired-t', { welch: false }, 'Compares the means of two independent groups assuming equal variances.'),
    rec_welch_t: rec("Welch's unpaired t test", 'unpaired-t', { welch: true }, 'Compares two independent means without assuming equal variances — the robust default.'),
    rec_mannwhitney: rec('Mann-Whitney U test', 'mannwhitney', {}, 'Rank-based comparison of two independent groups; no normality assumption.'),
    rec_paired_t: rec('Paired t test', 'paired-t', {}, 'Compares two matched measurements by analyzing their differences.'),
    rec_wilcoxon_paired: rec('Wilcoxon matched-pairs signed rank test', 'wilcoxon', {}, 'Rank-based alternative to the paired t test.'),
    rec_anova: rec('One-way ANOVA', 'anova', { posthoc: 'tukey' }, 'Compares means across 3+ independent groups, with post-hoc tests to see which pairs differ.'),
    rec_kruskal: rec('Kruskal-Wallis test', 'kruskal', { posthoc: 'holm-sidak' }, "Rank-based comparison of 3+ groups, with Dunn's post-hoc tests."),
    rec_rm_note: rec('Repeated-measures design', 'anova', { posthoc: 'tukey', note: true }, 'For truly repeated/matched designs a repeated-measures ANOVA or Friedman test is ideal. This version runs an ordinary one-way ANOVA — interpret with care if subjects are matched.'),
    rec_pearson: rec('Pearson correlation', 'pearson', {}, 'Measures linear association between two continuous variables (r).'),
    rec_spearman: rec('Spearman correlation', 'spearman', {}, 'Measures monotonic association using ranks (ρ); robust to outliers and non-linearity.'),
    rec_regression: rec('Simple linear regression', 'regression', {}, 'Fits Y = slope·X + intercept; gives slope, R², and confidence bands.'),
    rec_normality: rec('Normality tests', 'normality', {}, "Shapiro-Wilk, D'Agostino-Pearson and Anderson-Darling assess whether data could come from a normal distribution."),
    rec_grubbs: rec("Grubbs' outlier test", 'grubbs', {}, 'Detects a single outlier (or, iteratively, several) in roughly normal data.'),
    rec_survival: rec('Kaplan-Meier survival analysis', 'survival', {}, 'Estimates survival curves and compares them with the log-rank test.'),
    rec_twoway: rec('Two-way ANOVA', 'twoway', {}, 'Tests two factors at once (e.g. genotype and time) plus their interaction, using a Grouped data table.'),
  };

  function rec(title, kind, params, why) {
    return { rec: true, title, why, analysis: Object.assign({ kind }, params), guidance: kind };
  }

  // Per-test reference guidance shown in results and the analyze dialog.
  const TESTS = {
    'onesample-t': {
      name: 'One-sample t test',
      use: 'Compare the mean of a single group to a specific value you choose (e.g. a known standard or target).',
      assumptions: ['Data are continuous', 'Sampled values are independent', 'Population is approximately normal (or n is large)'],
      interpret: 'A small p-value means the sample mean is unlikely to equal your hypothetical value by chance alone.',
      alt: 'If data are skewed or ordinal, use the Wilcoxon signed-rank test.',
    },
    'unpaired-t': {
      name: 'Unpaired (two-sample) t test',
      use: 'Compare the means of two independent groups.',
      assumptions: ['Two independent groups', 'Each group approximately normal', "Equal variances (Student's) — Welch's drops this"],
      interpret: 'A small p-value indicates the two group means differ more than expected by chance. Report the difference and its 95% CI, not just p.',
      alt: 'Not normal? Use Mann-Whitney. Matched data? Use the paired t test.',
    },
    'paired-t': {
      name: 'Paired t test',
      use: 'Compare two measurements made on the same subjects (before/after, two methods, matched pairs).',
      assumptions: ['Pairs are matched correctly', 'The paired differences are approximately normal'],
      interpret: 'Tests whether the mean of the within-pair differences is zero. Pairing increases power when measurements are correlated.',
      alt: 'Non-normal differences? Use the Wilcoxon matched-pairs test.',
    },
    'mannwhitney': {
      name: 'Mann-Whitney U test',
      use: 'Compare two independent groups when data are ordinal, skewed, or non-normal.',
      assumptions: ['Two independent groups', 'Values can be ranked', 'Similar distribution shapes if interpreting as a median difference'],
      interpret: 'Compares the whole distributions via ranks. An exact p-value is computed for small samples without ties.',
      alt: 'If data are normal, the t test is more powerful.',
    },
    'wilcoxon': {
      name: 'Wilcoxon signed-rank test',
      use: 'Non-parametric alternative to the paired/one-sample t test.',
      assumptions: ['Paired or single sample', 'Differences are symmetric about the median (ideally)'],
      interpret: 'Ranks the absolute differences and compares positive vs negative rank sums.',
      alt: 'Normal differences? The paired t test is more powerful.',
    },
    'anova': {
      name: 'One-way ANOVA',
      use: 'Compare means across three or more independent groups in a single test.',
      assumptions: ['Independent groups', 'Approximately normal residuals', 'Roughly equal variances (else use Welch ANOVA)'],
      interpret: 'A significant ANOVA says at least one group differs. Use post-hoc tests (Tukey, Dunnett, Holm-Šídák) to find which pairs.',
      alt: 'Non-normal? Kruskal-Wallis. Unequal variances? Welch ANOVA (reported alongside).',
    },
    'kruskal': {
      name: 'Kruskal-Wallis test',
      use: 'Compare three or more independent groups without assuming normality.',
      assumptions: ['Independent groups', 'Values can be ranked'],
      interpret: "A significant result means at least one group's ranks differ. Use Dunn's post-hoc tests for pairwise comparisons.",
      alt: 'Normal data? One-way ANOVA is more powerful.',
    },
    'pearson': {
      name: 'Pearson correlation',
      use: 'Quantify the strength and direction of a linear relationship between two continuous variables.',
      assumptions: ['Linear relationship', 'Both variables approximately normal', 'No strong outliers'],
      interpret: 'r ranges −1…+1. r² is the fraction of variance shared. Correlation is not causation.',
      alt: 'Non-linear or ordinal? Use Spearman.',
    },
    'spearman': {
      name: 'Spearman correlation',
      use: 'Measure a monotonic relationship using ranks; robust to outliers and non-linearity.',
      assumptions: ['Monotonic relationship', 'Ordinal or continuous data'],
      interpret: 'ρ ranges −1…+1 based on ranked values.',
      alt: 'Linear & normal? Pearson is slightly more powerful.',
    },
    'regression': {
      name: 'Simple linear regression',
      use: 'Model and predict Y from X; estimate the slope and its confidence interval.',
      assumptions: ['Linear relationship', 'Independent residuals', 'Constant variance (homoscedasticity)', 'Normal residuals'],
      interpret: 'Slope = change in Y per unit X. R² = variance explained. The shaded band is the 95% CI of the fitted line.',
      alt: 'Just want association strength? Use correlation.',
    },
    'normality': {
      name: 'Normality tests',
      use: 'Check whether data are consistent with a normal distribution before choosing a parametric test.',
      assumptions: ['n ≥ 8 for D’Agostino/Anderson-Darling; ≥ 3 for Shapiro-Wilk'],
      interpret: 'A small p-value means the data deviate significantly from normal. With large n, trivial deviations become significant — also look at the histogram/skew.',
      alt: 'If non-normal, switch to a rank-based test.',
    },
    'grubbs': {
      name: "Grubbs' outlier test",
      use: 'Identify whether the most extreme value in a sample is a statistical outlier.',
      assumptions: ['Data are roughly normal apart from the suspected outlier', 'n ≥ 3'],
      interpret: 'Flags the single most extreme point. Iterative (ESD) mode removes and re-tests to find several outliers. Never delete data without a documented reason.',
      alt: 'Outliers are real biology sometimes — investigate before removing.',
    },
    'twoway': {
      name: 'Two-way ANOVA',
      use: 'Test the effect of two categorical factors (and their interaction) on a continuous outcome — e.g. treatment × time, or genotype × infection.',
      assumptions: ['Independent observations', 'Approximately normal residuals', 'Roughly equal variances across cells', 'Ideally balanced (equal n per cell) — unbalanced uses Type III SS'],
      interpret: 'Look at the interaction first: if it is significant, the effect of one factor depends on the other, so interpret the main effects with care. Follow up with multiple comparisons (e.g. compare groups within each row).',
      alt: 'One factor only? Use one-way ANOVA. Repeated measures on the same subjects need a matched/RM design.',
    },
    'srh': {
      name: 'Scheirer-Ray-Hare test',
      use: 'Nonparametric alternative to two-way ANOVA — two factors on ranked data. Use when residuals are non-normal or data are ordinal.',
      assumptions: ['Independent observations', 'Similar distribution shapes across cells'],
      interpret: 'Reports an H statistic per factor and for the interaction, each compared to chi-square. It is the two-way extension of the Kruskal-Wallis test.',
      alt: 'If residuals are roughly normal, ordinary two-way ANOVA is more powerful.',
    },
    'survival': {
      name: 'Kaplan-Meier + log-rank',
      use: 'Estimate survival/time-to-event curves and compare them between groups.',
      assumptions: ['Censoring is non-informative', 'Proportional hazards (for the log-rank to be most powerful)'],
      interpret: 'The log-rank test compares whole curves. Gehan-Breslow weights early events more. Report median survival and the hazard ratio.',
      alt: 'For covariates/adjustment, Cox regression (not included here).',
    },
    'descriptive': {
      name: 'Descriptive statistics',
      use: 'Summarize each group: mean, SD, SEM, median, quartiles, skewness, and 95% CI.',
      assumptions: [],
      interpret: 'Always inspect these (and a plot) before formal testing.',
      alt: '',
    },
  };

  return { NODES, TESTS, START: 'q_goal' };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Guidance;
