# StatLab — Scientific Statistics & Figures

A **desktop application** for analyzing scientific data and
producing publication-quality figures. Runs locally — no accounts, no data leaves
your machine.

![StatLab](https://img.shields.io/badge/status-ready-0d9488) ![Electron](https://img.shields.io/badge/desktop-Electron-2563eb)

## Download & install

**Windows:** download the installer from the
[**latest release**](https://github.com/danielmn7/StatLab/releases/latest) —
grab `StatLab-Setup-1.2.1.exe`, double-click it, and follow the prompts (it adds
Start Menu + desktop shortcuts and lets you pick the install folder). No Node,
npm, or accounts required.

> Windows may show a SmartScreen "unrecognized app" warning because the installer
> isn't code-signed — choose **More info → Run anyway**.

macOS and Linux users can build from source with the steps below.

### Run the latest version from source

The installer `.exe` is only rebuilt for tagged releases, so it can lag behind
`main`. To always run the current code straight from GitHub:

**Requirements:** [Git](https://git-scm.com/downloads) and
[Node.js](https://nodejs.org/) (includes npm).

```bash
git clone https://github.com/danielmn7/StatLab.git
cd StatLab
npm install        # first time only, installs Electron
npm start          # launches the StatLab desktop app
```

Already have a clone? Pull the latest changes and reinstall dependencies before
starting:

```bash
cd StatLab
git pull
npm install
npm start
```

No install/build step required to try it in a browser instead — see
**"Prefer the browser?"** below.

## Quick start (desktop app)

```bash
cd StatLab
npm install        # first time only
npm start          # launches the StatLab desktop app
```

Build a standalone installer/executable:

```bash
npm run dist:win   # Windows (.exe installer via electron-builder)
npm run dist       # current platform (mac .dmg / linux AppImage)
```

This writes to `dist/`:
- **`dist/StatLab-Setup-1.2.1.exe`** — the installer (double-click to install; adds
  Start Menu + desktop shortcuts, lets you pick the install folder).
- **`dist/win-unpacked/StatLab.exe`** — a portable build that runs without installing.

The desktop app has a native **File** menu (New Table, Open/Save Project,
Import Data, Export Figure) with real file dialogs, plus Edit/View/Analyze menus.

**Prefer the browser?** The same app also runs as a web page — serve the folder
(`python -m http.server 8000`) and open it, or just double-click `index.html`.

Then **Load an example**, **Import data**, or **＋ New table** and start typing.

### Working with the data grid
The grid behaves like a spreadsheet:
- **Click + drag** to select a range of cells; **Shift+click** or **Shift+arrows** to extend.
- **Ctrl+C / Ctrl+V** to copy/paste ranges — paste straight from **Excel/Sheets/CSV**.
- **Ctrl+Shift+V** pastes **transposed** (rows↔columns), or use the **⇄ Transpose**
  button to flip data that's already in the grid.
- **Type** to start editing a cell; **Enter/Tab/arrows** to move; **Delete** clears the selection.

## What it does

### Statistical tests
- **t tests** — one-sample, unpaired (Student's, equal variance), unpaired with
  **Welch's correction** (unequal variance), and paired.
- **ANOVA** — one-way, plus **Welch's ANOVA** for unequal variances, with post-hoc
  comparisons: **Tukey HSD**, **Dunnett** (vs any control), **Holm-Šídák**,
  **Bonferroni**, **Šídák**, or **choose specific comparisons** to run.
- **Two-way ANOVA** (Grouped tables) — two factors and their **interaction**, with
  **Type III sums of squares** (correct for unbalanced designs), partial η² effect
  sizes, cell means, and multiple comparisons within rows or columns.
- **Non-parametric** — **Mann-Whitney U** (exact for small samples, tie-corrected
  normal approximation otherwise), **Wilcoxon** matched-pairs signed rank,
  **Kruskal-Wallis** with **Dunn's** post-hoc, and **Scheirer-Ray-Hare**
  (non-parametric two-way). Every parametric test has a rank-based counterpart.
- **Correlation & regression** — Pearson, Spearman, and simple linear regression
  with confidence bands.
- **Normality** — **Shapiro-Wilk** (Royston), **D'Agostino-Pearson** omnibus K²,
  and **Anderson-Darling**. Parametric tests auto-flag a normality check.
- **Outliers** — **Grubbs'** test (single and iterative/ESD).
- **Survival** — **Kaplan-Meier** curves, **log-rank (Mantel-Cox)** and
  **Gehan-Breslow-Wilcoxon** tests, median survival and hazard ratio.

### Guidance
- A **"Which test should I use?"** decision tree walks you from your question to the
  right test, explains the assumptions, and runs it on your data with one click.
- Every analysis dialog has inline "when to use this & how to read it" guidance.
- Results include plain-language verdicts, a ready-to-paste report sentence, and
  automatic assumption checks.

### Figures
Bar charts with error bars (SD / SEM / 95% CI), column scatter (dot) plots, box-
and-whisker plots, before–after paired plots, XY scatter with regression line and
CI band, and Kaplan-Meier curves with censor ticks, numbers-at-risk, and CI bands.
Significance brackets are added automatically — switch them between asterisks
(`*`, `**`, `***`, `****`), an exact **P value**, or a **P < threshold** summary, and
restyle their color, text size, weight, and connecting line. **Hover any bar** to see
that group's **mean, median, mode, and range** at a glance, and optionally overlay
**every individual data point** — the bar turns translucent so the points stay clearly
visible. Customize colors, titles, axes, error-bar type, **bar width / point
spacing** — tighten or spread the columns to fine-tune the gap between categories —
and the **font size and bold weight of titles and axis labels** (tick numbers scale
along but stay smaller so they never crowd the plot), then export to **SVG** or **PNG**.

### Saving
Your work autosaves to the browser. Use **Save** to download a `.json` project file
and **Open** to load one back (portable across machines).

### Opening GraphPad Prism files
**Open Prism** (or drag a `.prism` file onto the window) reads a modern GraphPad
Prism project. Each Prism data table becomes a StatLab table — Column, Grouped
(two-way), XY, and Survival layouts are recognized, along with group names,
replicate counts, and row titles. Anything Prism recorded about a table — **which
analyses were run and their result notes** — is dropped into that table's **Notes**,
marked as imported from Prism, ready for the numbers to be re-analyzed in StatLab.

### Notes
Every data table has a **Notes** panel beside it (collapsible with **Hide**). Write
observations, methods, or context there; it saves with your project. When you open a
`.prism` file, Prism's recorded tests and results land here automatically, with room
left below for your own notes.

## Accuracy

The statistics engine is verified against authoritative references — see
`tests/`. Examples that are reproduced exactly:

- Studentized-range (Tukey) critical values vs published tables.
- Dunnett critical values vs Monte-Carlo simulation and canonical tables.
- Shapiro-Wilk coefficients vs Shapiro & Wilk (1965) Table 5.
- Grubbs' G vs the NIST example.
- Kaplan-Meier medians and log-rank χ² = 16.79 vs the Freireich leukemia dataset.

Run the checks (requires Node and Python):

```bash
node tests/check.js         # stats tests vs an independent Python oracle
node tests/prism.check.js   # .prism import mapping (pure Node, no Python)
```

## Data formats

| Table type | Layout |
|---|---|
| **Column** | Each column is a group/condition; each row a replicate. For paired tests, columns are matched row-by-row. |
| **Grouped** | Two-factor layout: each **row** is a level of factor 1 (e.g. time), each **column group** is a level of factor 2 (e.g. genotype), and the side-by-side **subcolumns** are replicates. Drives two-way ANOVA. |
| **XY** | First column X, second column Y. |
| **Survival** | One row per subject: `Time`, `Status` (1 = event, 0 = censored), `Group`. |

Empty cells are ignored. Paste tab- or comma-separated data anywhere.

## Project layout

```
StatLab/
  package.json          npm scripts + Electron/electron-builder config
  electron/main.js      desktop shell: window, native menu, file dialogs
  index.html            app shell (renderer — also the web entry point)
  css/styles.css        styling
  js/
    stats-core.js       distributions (gamma, beta, t, F, χ², studentized range)
    stats-tests.js      t-tests, ANOVA (1- & 2-way), post-hoc, non-parametric, regression
    stats-normality.js  Shapiro-Wilk, D'Agostino-Pearson, Anderson-Darling, Grubbs
    survival.js         Kaplan-Meier, log-rank, Gehan-Breslow
    charts.js           SVG figure engine
    data.js             data model, CSV/clipboard parsing, samples
    prism-import.js     reads GraphPad Prism .prism files (ZIP → tables + notes)
    guidance.js         test-selection decision tree + reference guidance
    app.js              UI controller (spreadsheet grid, analyses, graphs)
  tests/                verification harness (Node + Python)
```

The renderer (`index.html` + `js/`) is identical in the desktop and web versions;
the Electron shell only adds the native window, menu, and file dialogs.

## Notes & limits
- p-values use exact algorithms where practical (e.g. Mann-Whitney for small n) and
  well-established approximations otherwise; each result states the method used.
- Two-way ANOVA is included (Grouped tables). Repeated-measures/mixed-effects ANOVA
  and Cox regression are not; the guide flags when a repeated-measures design would be
  more appropriate.
- This tool supports analysis and figure-making; always sanity-check results
  against your experimental design.
