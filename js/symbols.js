/*
 * symbols.js — Greek letters and scientific symbols for every text field.
 *
 *  - A small Ω button appears beside the focused text field; it opens a palette.
 *  - Ctrl/⌘+G opens the palette from the keyboard (arrows + Enter insert, Tab
 *    switches group, Esc closes).
 *  - LaTeX-style shortcuts: type \alpha then Space (or Enter/Tab) to get α.
 *    \^2 → ², \_0 → ₀, \^-1 → ⁻¹, \pm → ±, \mu → μ, \micro → µ …
 *
 * Symbols are inserted with the browser's own editing command, so the field
 * receives a normal `input` event (models update as if the user typed) and
 * Ctrl+Z undoes the insertion.
 */
const Symbols = (function () {
  'use strict';

  // [symbol, name, shortcut (without backslash), display (optional)]
  const GROUPS = [
    {
      id: 'greek', label: 'Greek', items: [
        ['α', 'alpha', 'alpha'], ['β', 'beta', 'beta'], ['γ', 'gamma', 'gamma'], ['δ', 'delta', 'delta'],
        ['ε', 'epsilon', 'epsilon'], ['ζ', 'zeta', 'zeta'], ['η', 'eta', 'eta'], ['θ', 'theta', 'theta'],
        ['ι', 'iota', 'iota'], ['κ', 'kappa', 'kappa'], ['λ', 'lambda', 'lambda'], ['μ', 'mu', 'mu'],
        ['ν', 'nu', 'nu'], ['ξ', 'xi', 'xi'], ['ο', 'omicron', 'omicron'], ['π', 'pi', 'pi'],
        ['ρ', 'rho', 'rho'], ['σ', 'sigma', 'sigma'], ['ς', 'final sigma', 'varsigma'], ['τ', 'tau', 'tau'],
        ['υ', 'upsilon', 'upsilon'], ['φ', 'phi', 'phi'], ['χ', 'chi', 'chi'], ['ψ', 'psi', 'psi'],
        ['ω', 'omega', 'omega'], ['ϵ', 'lunate epsilon', 'varepsilon'], ['ϑ', 'theta (script)', 'vartheta'], ['ϕ', 'phi (script)', 'varphi'],
        ['Γ', 'Gamma', 'Gamma'], ['Δ', 'Delta', 'Delta'], ['Θ', 'Theta', 'Theta'], ['Λ', 'Lambda', 'Lambda'],
        ['Ξ', 'Xi', 'Xi'], ['Π', 'Pi', 'Pi'], ['Σ', 'Sigma', 'Sigma'], ['Υ', 'Upsilon', 'Upsilon'],
        ['Φ', 'Phi', 'Phi'], ['Ψ', 'Psi', 'Psi'], ['Ω', 'Omega', 'Omega'],
      ],
    },
    {
      id: 'math', label: 'Math', items: [
        ['±', 'plus–minus', 'pm'], ['∓', 'minus–plus', 'mp'], ['×', 'times', 'times'], ['÷', 'divide', 'div'],
        ['·', 'middle dot', 'cdot'], ['−', 'minus sign', 'minus'], ['≤', 'less or equal', 'le'], ['≥', 'greater or equal', 'ge'],
        ['≠', 'not equal', 'ne'], ['≈', 'approximately', 'approx'], ['∼', 'tilde / distributed as', 'sim'], ['≡', 'identical to', 'equiv'],
        ['∝', 'proportional to', 'propto'], ['≪', 'much less than', 'll'], ['≫', 'much greater than', 'gg'], ['∞', 'infinity', 'infty'],
        ['√', 'square root', 'sqrt'], ['∑', 'sum', 'sum'], ['∏', 'product', 'prod'], ['∫', 'integral', 'int'],
        ['∂', 'partial', 'partial'], ['∇', 'nabla', 'nabla'], ['°', 'degree', 'deg'], ['′', 'prime', 'prime'],
        ['″', 'double prime', 'dprime'], ['‰', 'per mille', 'permil'], ['∈', 'element of', 'in'], ['∉', 'not element of', 'notin'],
        ['⊂', 'subset', 'subset'], ['∩', 'intersection', 'cap'], ['∪', 'union', 'cup'], ['∅', 'empty set', 'emptyset'],
        ['∀', 'for all', 'forall'], ['∃', 'there exists', 'exists'], ['¬', 'not', 'neg'], ['∧', 'and', 'wedge'],
        ['∨', 'or', 'vee'], ['x̄', 'x bar (mean)', 'xbar'], ['ȳ', 'y bar (mean)', 'ybar'], ['p̂', 'p hat (estimate)', 'phat'],
        ['̄', 'bar over the previous letter', 'bar', '◌̄'], ['̂', 'hat over the previous letter', 'hat', '◌̂'],
      ],
    },
    {
      id: 'script', label: 'Super / sub', items: [
        ['⁰', 'superscript 0', '^0'], ['¹', 'superscript 1', '^1'], ['²', 'superscript 2', '^2'], ['³', 'superscript 3', '^3'],
        ['⁴', 'superscript 4', '^4'], ['⁵', 'superscript 5', '^5'], ['⁶', 'superscript 6', '^6'], ['⁷', 'superscript 7', '^7'],
        ['⁸', 'superscript 8', '^8'], ['⁹', 'superscript 9', '^9'], ['⁺', 'superscript plus', '^+'], ['⁻', 'superscript minus', '^-'],
        ['⁼', 'superscript equals', '^='], ['⁽', 'superscript (', '^('], ['⁾', 'superscript )', '^)'], ['ⁿ', 'superscript n', '^n'],
        ['ⁱ', 'superscript i', '^i'], ['⁻¹', 'to the power −1', '^-1'], ['⁻²', 'to the power −2', '^-2'], ['⁻³', 'to the power −3', '^-3'],
        ['₀', 'subscript 0', '_0'], ['₁', 'subscript 1', '_1'], ['₂', 'subscript 2', '_2'], ['₃', 'subscript 3', '_3'],
        ['₄', 'subscript 4', '_4'], ['₅', 'subscript 5', '_5'], ['₆', 'subscript 6', '_6'], ['₇', 'subscript 7', '_7'],
        ['₈', 'subscript 8', '_8'], ['₉', 'subscript 9', '_9'], ['₊', 'subscript plus', '_+'], ['₋', 'subscript minus', '_-'],
        ['₌', 'subscript equals', '_='], ['₍', 'subscript (', '_('], ['₎', 'subscript )', '_)'], ['ₐ', 'subscript a', '_a'],
        ['ₑ', 'subscript e', '_e'], ['ₓ', 'subscript x', '_x'], ['ₘ', 'subscript m', '_m'], ['ₙ', 'subscript n', '_n'],
        ['ₚ', 'subscript p', '_p'], ['ₛ', 'subscript s', '_s'], ['ₜ', 'subscript t', '_t'], ['ₖ', 'subscript k', '_k'],
      ],
    },
    {
      id: 'units', label: 'Units & arrows', items: [
        ['µ', 'micro sign (units: µg, µL)', 'micro'], ['°', 'degree', 'deg'], ['℃', 'degree Celsius', 'celsius'], ['℉', 'degree Fahrenheit', 'fahrenheit'],
        ['Å', 'ångström', 'AA'], ['ℓ', 'script l', 'ell'], ['ℏ', 'h-bar', 'hbar'], ['‰', 'per mille', 'permil'],
        ['→', 'right arrow', 'to'], ['←', 'left arrow', 'gets'], ['↔', 'left–right arrow', 'leftrightarrow'], ['⇌', 'equilibrium', 'rightleftharpoons'],
        ['⇒', 'implies', 'Rightarrow'], ['↑', 'up arrow (increase)', 'uparrow'], ['↓', 'down arrow (decrease)', 'downarrow'], ['…', 'ellipsis', 'ldots'],
        ['–', 'en dash (ranges: 10–20)', 'ndash'], ['—', 'em dash', 'mdash'], ['†', 'dagger', 'dagger'], ['‡', 'double dagger', 'ddagger'],
        ['•', 'bullet', 'bullet'], ['✓', 'check mark', 'checkmark'], ['✗', 'cross mark', 'crossmark'], ['§', 'section', 'S'],
        ['♀', 'female', 'female'], ['♂', 'male', 'male'], ['®', 'registered', 'circledR'], ['™', 'trademark', 'trademark'],
      ],
    },
  ];

  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ' };

  // Named shortcuts (\name). Superscript / subscript runs are handled by lookup().
  const SHORTCUTS = {};
  GROUPS.forEach((g) => g.items.forEach(([s, , k]) => { if (k && !/^[\^_]/.test(k) && !(k in SHORTCUTS)) SHORTCUTS[k] = s; }));
  Object.assign(SHORTCUTS, {
    leq: '≤', geq: '≥', neq: '≠', inf: '∞', degree: '°', degC: '℃', degF: '℉', angstrom: 'Å', um: 'µ',
    rightarrow: '→', leftarrow: '←', uparrow: '↑', downarrow: '↓', eq: '⇌', land: '∧', lor: '∨', dots: '…',
  });

  // \name → symbol, or null when the name is unknown. Case-sensitive (\Delta vs \delta).
  function lookup(name) {
    if (!name) return null;
    const lead = name[0];
    if (lead === '^' || lead === '_') {
      const map = lead === '^' ? SUP : SUB, rest = name.slice(1);
      if (!rest) return null;
      let out = '';
      for (const ch of rest) { if (!(ch in map)) return null; out += map[ch]; }
      return out;
    }
    return Object.prototype.hasOwnProperty.call(SHORTCUTS, name) ? SHORTCUTS[name] : null;
  }
  const TAIL = /\\([A-Za-z]+|[\^_][0-9A-Za-z+\-=()]+)$/;
  // If the text just before `caret` ends in a known \shortcut, return what to replace.
  function shortcutBefore(text, caret) {
    const m = TAIL.exec(String(text).slice(0, caret));
    if (!m) return null;
    const symbol = lookup(m[1]);
    return symbol == null ? null : { start: caret - m[0].length, end: caret, symbol, name: m[1] };
  }

  // ------------------------------------------------------------------ DOM
  if (typeof document === 'undefined') return { GROUPS, SHORTCUTS, lookup, shortcutBefore };

  const TEXT_TYPES = new Set(['text', 'search', '']);
  function isTextField(node) {
    if (!node || node.disabled || node.readOnly) return false;
    if (node.dataset && node.dataset.symbols === 'off') return false;
    if (node.tagName === 'TEXTAREA') return true;
    return node.tagName === 'INPUT' && TEXT_TYPES.has((node.getAttribute('type') || '').toLowerCase());
  }

  // Insert like typing: native input event + undo history. Falls back to
  // setRangeText where the editing command is unavailable.
  function insertText(field, text) {
    if (document.activeElement !== field) field.focus();
    let done = false;
    try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
    if (!done) {
      const s = field.selectionStart, e = field.selectionEnd;
      field.setRangeText(text, s, e, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function replaceRange(field, start, end, text) { field.setSelectionRange(start, end); insertText(field, text); }

  const RECENT_KEY = 'statlab_recent_symbols';
  let recent = [];
  try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); if (Array.isArray(r)) recent = r.filter((x) => typeof x === 'string').slice(0, 12); } catch (e) { recent = []; }
  const ITEM_BY_SYMBOL = new Map();
  GROUPS.forEach((g) => g.items.forEach((it) => { if (!ITEM_BY_SYMBOL.has(it[0])) ITEM_BY_SYMBOL.set(it[0], it); }));
  function remember(sym) {
    recent = [sym].concat(recent.filter((s) => s !== sym)).slice(0, 12);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch (e) { /* storage unavailable */ }
  }

  let field = null;      // the text field the palette serves
  let trigger = null, panel = null, groupId = 'greek', hi = -1, raf = 0;
  const COLS = 8;

  function make(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  // Nothing in the palette may take focus from the field it serves (a grid cell
  // editor commits on blur).
  function keepFocus(node) { node.addEventListener('mousedown', (e) => e.preventDefault()); return node; }

  function ensureTrigger() {
    if (trigger) return trigger;
    trigger = keepFocus(make('button', 'sym-trigger', 'Ω'));
    trigger.type = 'button'; trigger.tabIndex = -1; trigger.hidden = true;
    trigger.title = 'Insert a symbol — Greek letters, math, units (Ctrl+G)';
    trigger.setAttribute('aria-label', 'Insert symbol');
    trigger.addEventListener('click', () => { if (isOpen()) close(); else if (field) open(field); });
    document.body.append(trigger);
    return trigger;
  }
  function ensurePanel() {
    if (panel) return panel;
    panel = keepFocus(make('div', 'sym-panel'));
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Insert symbol');
    panel.addEventListener('click', (e) => {
      const tab = e.target.closest('.sym-tab');
      if (tab) { groupId = tab.dataset.group; hi = -1; render(); return; }
      const btn = e.target.closest('.sym-btn');
      if (btn) choose(btn.dataset.sym);
      if (e.target.closest('.sym-close')) close();
    });
    panel.addEventListener('mouseover', (e) => { const btn = e.target.closest('.sym-btn'); if (btn) showInfo(btn.dataset.sym); });
    document.body.append(panel);
    return panel;
  }
  function groups() {
    const list = GROUPS.slice();
    if (recent.length) list.unshift({ id: 'recent', label: 'Recent', items: recent.map((s) => ITEM_BY_SYMBOL.get(s) || [s, s, '']) });
    return list;
  }
  function currentGroup() { const gs = groups(); return gs.find((g) => g.id === groupId) || gs.find((g) => g.id === 'greek'); }
  function infoText(sym) {
    const it = ITEM_BY_SYMBOL.get(sym);
    if (!it) return sym;
    return (it[3] || it[0]) + '  ' + it[1] + (it[2] ? '   ·   type \\' + it[2] + ' + Space' : '');
  }
  function showInfo(sym) { const info = panel && panel.querySelector('.sym-info'); if (info) info.textContent = infoText(sym); }
  function render() {
    const p = ensurePanel(); p.innerHTML = '';
    const head = make('div', 'sym-head');
    const tabs = make('div', 'sym-tabs');
    const gs = groups(), cur = currentGroup();
    groupId = cur.id;
    gs.forEach((g) => {
      const t = make('button', 'sym-tab' + (g.id === cur.id ? ' active' : ''), g.label);
      t.type = 'button'; t.tabIndex = -1; t.dataset.group = g.id;
      tabs.append(t);
    });
    const x = make('button', 'sym-close', '×'); x.type = 'button'; x.tabIndex = -1; x.title = 'Close (Esc)';
    head.append(tabs, x);
    const grid = make('div', 'sym-grid');
    cur.items.forEach((it, i) => {
      const b = make('button', 'sym-btn' + (i === hi ? ' hi' : ''), it[3] || it[0]);
      b.type = 'button'; b.tabIndex = -1; b.dataset.sym = it[0];
      b.title = it[1] + (it[2] ? '  (\\' + it[2] + ')' : '');
      grid.append(b);
    });
    const info = make('div', 'sym-info', hi >= 0 && cur.items[hi] ? infoText(cur.items[hi][0]) : 'Tip: type \\alpha then Space for α · \\^2 → ² · \\_0 → ₀');
    p.append(head, grid, info);
    const h = grid.querySelector('.hi');
    if (h && !p.hidden) h.scrollIntoView({ block: 'nearest' });
  }
  function choose(sym) {
    if (!field || !field.isConnected) { close(); return; }
    insertText(field, sym);
    remember(sym);
    if (groupId === 'recent') hi = 0;
    render(); place();
  }

  function rectOk(r) { return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight; }
  function place() {
    raf = 0;
    if (!field || !field.isConnected) { hideAll(); return; }
    const r = field.getBoundingClientRect();
    if (trigger && !trigger.hidden) {
      if (!rectOk(r)) trigger.style.visibility = 'hidden';
      else {
        trigger.style.visibility = '';
        const size = 18;
        trigger.style.left = Math.round(Math.min(r.right - size / 2 - 4, window.innerWidth - size - 2)) + 'px';
        trigger.style.top = Math.round(r.bottom - size / 2 - 2) + 'px';
      }
    }
    if (panel && !panel.hidden) {
      const pw = panel.offsetWidth, ph = panel.offsetHeight, gap = 6;
      let top = r.bottom + gap + 6;
      if (top + ph > window.innerHeight - 8 && r.top - gap - ph > 8) top = r.top - gap - ph;
      top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
      const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8, Math.max(r.left, 8)));
      panel.style.left = Math.round(left) + 'px';
      panel.style.top = Math.round(top) + 'px';
    }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(place); }

  function isOpen() { return !!(panel && !panel.hidden); }
  function open(target, opts = {}) {
    target = target || document.activeElement;
    if (!isTextField(target)) return false;
    field = target;
    if (document.activeElement !== field) field.focus();
    hi = opts.keyboard ? 0 : -1;
    ensurePanel().hidden = false;
    render(); place();
    return true;
  }
  function close() { if (panel) panel.hidden = true; hi = -1; }
  function hideAll() { close(); if (trigger) trigger.hidden = true; field = null; }

  function moveHi(delta) {
    const n = currentGroup().items.length;
    hi = hi < 0 ? 0 : Math.max(0, Math.min(n - 1, hi + delta));
    render();
  }
  function cycleGroup(dir) {
    const gs = groups(), i = gs.findIndex((g) => g.id === currentGroup().id);
    groupId = gs[(i + dir + gs.length) % gs.length].id; hi = 0; render(); place();
  }

  // Window-level capture runs before the grid editor's and modals' own handlers.
  window.addEventListener('keydown', (e) => {
    const target = e.target;
    if (isOpen() && target === field) {
      const k = e.key;
      const nav = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS };
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (k in nav && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); moveHi(nav[k]); return; }
      if (k === 'Tab') { e.preventDefault(); e.stopPropagation(); cycleGroup(e.shiftKey ? -1 : 1); return; }
      if (k === 'Enter' && hi >= 0) {
        const it = currentGroup().items[hi];
        e.preventDefault(); e.stopPropagation();
        if (it) choose(it[0]);
        return;
      }
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && hi >= 0) { hi = -1; render(); }
    }
    // \shortcut expansion on Space / Enter / Tab.
    if (!isTextField(target) || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Tab') return;
    const s = target.selectionStart, end = target.selectionEnd;
    if (s == null || s !== end) return;
    const hit = shortcutBefore(target.value, s);
    if (!hit) return;
    replaceRange(target, hit.start, hit.end, hit.symbol);
    // Space only finishes the shortcut (like LaTeX); Enter/Tab still do their usual job.
    if (e.key === ' ') e.preventDefault();
  }, true);

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!isTextField(t)) { hideAll(); return; }
    if (t !== field) close();
    field = t;
    ensureTrigger().hidden = t.dataset.symbols === 'quiet';
    schedule();
  });
  document.addEventListener('focusout', (e) => {
    if (e.target !== field) return;
    // Focus moving to another text field is handled by its focusin.
    setTimeout(() => { if (field && document.activeElement !== field) hideAll(); }, 0);
  });
  window.addEventListener('scroll', () => { if (field) schedule(); }, true);
  window.addEventListener('resize', () => { if (field) schedule(); });
  document.addEventListener('input', (e) => { if (e.target === field) schedule(); }, true);

  return { GROUPS, SHORTCUTS, lookup, shortcutBefore, isTextField, insertText, open, close, isOpen, field: () => field };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Symbols;
