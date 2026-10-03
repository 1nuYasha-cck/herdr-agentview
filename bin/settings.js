#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// The settings popup: every key of the plugin's config.toml, edited in place.
//
//   node bin/settings.js          run the editor (Herdr opens it as a popup)
//   node bin/settings.js --open   ask Herdr to open the popup (the action)
//
// Herdr has no settings hook for plugins, so this is a small TUI of our own,
// shaped like Herdr's settings popup: one row per key, arrows to move and
// change, one key to save. Saving rewrites only the lines that changed — the
// user's comments and ordering survive — and restarts the daemon, which reads
// its config once at start.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const config = require('../lib/config');
const palette = require('../lib/palette');
const control = require('../lib/control');
const state = require('../lib/state');
const view = require('../lib/view');
const managed = require('../lib/managed-config');
const { detachedNode } = require('../lib/spawn');
const { scrollTop } = require('../lib/scroll-window');
const { wrapByWidth } = require('../lib/textwidth');
const { pluginId, pluginConfigDir, ensureDir, stateRoot } = require('../lib/paths');
const { editTopLevel, editTable, writeAtomic } = require('../lib/toml-blocks');
const identity = require('../lib/identity');

/* ------------------------------------------------------------ the schema */

// The order row's words, and the lib/view.js modes they stand for. `off` is
// Herdr's own order — the plugin's rows stay, only the sort override goes.
const ORDER_MODE = { active: 'grouped', recent: 'recent', off: null };
const MODE_ORDER = { grouped: 'active', recent: 'recent', null: 'off' };

// Whether the plugin's sidebar rows are installed — the managed block's
// presence in Herdr's config IS that state (lib/managed-config.js).
function panelValue() {
  return managed.inspect().text?.includes(managed.SIDEBAR_START) ? 'plugin' : 'herdr';
}

// The persisted order choice (lib/view.js), as the row's word.
function orderValue() {
  return MODE_ORDER[view.mode()];
}

// One entry per key the plugin reads (lib/config.js). `table` is the TOML
// table the key lives in; absent means top level. A `virtual` field is not a
// config key at all but live state, read by its `read` and switched from here
// on save — the same two things the view keys switch, so a key press and this
// popup never disagree about what the current state is.
const FIELDS = [
  {
    key: 'agents_panel',
    label: '面板来源',
    kind: 'enum',
    options: ['plugin', 'herdr'],
    fallback: 'plugin',
    virtual: true,
    read: panelValue,
    help: 'Agents 面板用谁的行：plugin = 本插件的样式和排序，herdr = Herdr 原生样式。很少改动，所以放在设置里而不是快捷键。',
  },
  {
    key: 'order',
    label: '排序方式',
    kind: 'enum',
    options: ['active', 'recent', 'off'],
    fallback: 'active',
    virtual: true,
    read: orderValue,
    help: 'Agents 面板的顺序：active = 按项目分组、最忙的在前、搁置的在后；recent = 不分组、按最近活动平铺；off = Herdr 原顺序。仅 agents_panel 为 plugin 时有效。',
  },
  {
    key: 'reorder_workspaces',
    label: '工作区重排',
    kind: 'bool',
    fallback: false,
    help: '让这台机器上工作区本身的顺序跟随活跃度，最近有活动的排前面；排序方式为 off 时也生效，这样每台机器内部活跃的在前，机器顺序仍用 Herdr 原生的。注意：上方工作区列表也会随之移动。',
  },
  {
    key: 'variant',
    label: '图标样式',
    kind: 'enum',
    options: ['auto', 'font', 'text', 'none'],
    fallback: 'auto',
    help: '厂商 logo 和状态标记的显示方式：font = 图标字体，text = 普通 Unicode 字符，none = 不显示，auto = 自动（只有 Linux 能探测字体，其他系统按 text 处理）。',
  },
  {
    key: 'done_hold',
    label: '完成标记保留',
    kind: 'enum',
    options: ['until_seen', 6, 15, 30, 60, 120],
    fallback: 'until_seen',
    help: '“完成 ✓”标记保留多久：until_seen = 直到你聚焦到那个窗格；也可以选一个秒数，到时自动消失。',
  },
  { key: 'blocked_hold', label: '等待标记保留', kind: 'bool', fallback: true, help: '开启：“等待回答 ?”一直保留到 agent 重新开始工作；关闭：只在 agent 实际处于等待时显示。', },
  {
    key: 'idle_grace_seconds',
    label: '空闲防抖',
    kind: 'number',
    step: 0.5,
    min: 0,
    max: 30,
    fallback: 2.5,
    help: '空闲状态要持续这么多秒，才算上一轮对话结束，用来过滤状态识别时的瞬间抖动。',
  },
  {
    key: 'activity_fresh_minutes',
    label: '“刚活跃”时长',
    kind: 'number',
    step: 5,
    min: 1,
    max: 1440,
    fallback: 15,
    help: '一轮结束后的这段分钟数内，空闲的 agent 仍显示为“刚活跃”（浅绿色）。',
  },
  {
    key: 'activity_stale_minutes',
    label: '“已搁置”时长',
    kind: 'number',
    step: 30,
    min: 1,
    max: 10080,
    fallback: 120,
    help: '超过这么多分钟没有新一轮，空闲的 agent 会变灰变暗，并排到本组最后。',
  },
  {
    key: 'group_indent',
    label: '分组缩进',
    kind: 'number',
    step: 1,
    min: 0,
    max: 8,
    fallback: 2,
    help: '仅 grouped 布局：成员在工作区标题下缩进几列；0 = 不缩进。',
  },
  {
    key: 'group_gap',
    label: '分组空行',
    kind: 'bool',
    fallback: false,
    help: '仅 grouped 布局：不同工作区之间是否空一行，默认关闭（agent 之间紧贴）。',
  },
  {
    key: 'layout',
    label: '条目布局',
    kind: 'enum',
    options: ['entry', 'grouped'],
    fallback: 'entry',
    help: 'entry = 每个 agent 自成一项（标题行 + 项目行），选中时只框住它自己；grouped = Radar 原样，工作区标题藏在组内第一项里。',
  },
  {
    key: 'machine_rank',
    label: '机器排序',
    kind: 'number',
    step: 1,
    min: 0,
    max: 9,
    fallback: 0,
    help: '仅排序方式为 active 或 recent 时有用：多台机器的 agent 放在一起时，这台机器排第几，数字小的在前。方向固定，从哪台看都一样；想要本机在前，请把排序方式设为 off。',
  },
  {
    key: 'agent_row_gap',
    label: '条目间距',
    kind: 'number',
    step: 1,
    min: 0,
    max: 2,
    fallback: 0,
    help: '下半部分每两个 agent 条目之间空几行，默认 0 = 紧贴。空行画在条目外面，不会被选中框框住。',
  },
  {
    key: 'title_wrap',
    label: '标题最多行数',
    kind: 'number',
    step: 1,
    min: 1,
    max: 4,
    fallback: 3,
    help: '长标题最多换成几行，装不下的结尾用 … 表示；1 = 不换行（和 Herdr 原样一样，用省略号截断）。',
  },
  {
    key: 'title_width',
    label: '换行宽度',
    kind: 'number',
    step: 1,
    min: 10,
    max: 120,
    fallback: 32,
    help: '标题按多少列换行，默认 32，等于你现在的 sidebar_max_width。调整了侧边栏宽度后，把这里改成相应的列数。',
  },
  {
    key: 'title_margin',
    label: '换行微调',
    kind: 'number',
    step: 1,
    min: -10,
    max: 20,
    fallback: 0,
    help: '微调换行位置：正数更早换行，负数更晚。标题右侧还被省略号截断就调大。远程机器的标题多缩进 2 列，那台机器上建议设成 2。',
  },
  {
    key: 'git_row',
    label: 'Git 分支行',
    kind: 'enum',
    options: ['always', 'auto', 'off'],
    fallback: 'always',
    help: '每个 agent 条目的第三行，显示它所在目录的 Git 分支：always = 只要在 Git 仓库里就显示；auto = 只在 worktree 或非 main/master 分支时显示；off = 不显示。',
  },
  {
    key: 'git_branch_mark',
    label: '分支图标',
    kind: 'glyph',
    fallback: '\ue0a0',
    help: '分支名前面的图标，需要 Nerd Font（Ghostty 自带）。填码点如 U+E0A0，留空 = 不显示图标。右上角也用它。',
  },
  {
    key: 'git_worktree_mark',
    label: 'worktree 图标',
    kind: 'glyph',
    fallback: '\uf418',
    help: '目录是 Git worktree 时用的图标：侧边栏第三行用它代替分支图标，右上角用它标出所属的主仓库。填码点如 U+F418，留空 = 不显示。',
  },
  {
    key: 'space_agents',
    label: '工作区列出数',
    kind: 'number',
    step: 1,
    min: 0,
    max: 6,
    fallback: 4,
    help: '上方工作区列表里每个工作区最多列出几个 agent（每个一行），多出来的合并成 +N；0 = 只在一行里显示厂商图标。',
  },
  {
    key: 'split_corner',
    label: '分屏连接线',
    kind: 'bool',
    fallback: false,
    help: '同一标签页里分屏的其他窗格，是否用 ├─ 连接线挂在第一个窗格下面；关闭则当作普通行。',
  },
  {
    key: 'row_label',
    label: '行显示内容',
    kind: 'enum',
    options: ['title', 'tab', 'both'],
    fallback: 'title',
    // A file from before this setting says `show_tab = true`, which renders
    // as `both` (lib/config.js); the popup shows what renders, not the
    // fallback.
    legacy: (raw) => (raw.show_tab === true ? 'both' : undefined),
    help: 'agent 那一行显示什么：title = 会话标题，tab = 所在标签页的名字，both = 两者都显示。',
  },
  {
    key: 'trim_group_prefix',
    label: '去掉重复项目名',
    kind: 'bool',
    fallback: true,
    help: '标题开头如果重复了工作区名，就把它去掉（项目名已经单独显示了）。',
  },
  {
    key: 'worktree_mark',
    label: 'worktree 标记',
    kind: 'glyph',
    fallback: '\uf418',
    help: '仅 grouped 布局：worktree 标题前的小图标，需要 Nerd Font。填码点如 U+F418，留空 = 不显示。',
  },
  {
    key: 'follow_appearance',
    label: '跟随明暗',
    kind: 'bool',
    fallback: true,
    help: 'Herdr 主题是否跟随系统的浅色/深色模式自动切换（每分钟检查一次）。',
  },
  {
    key: 'active_row_bg_light',
    label: '选中行底色（浅色）',
    table: 'colors',
    kind: 'color',
    fallback: palette.chrome.light.active_row_bg,
    help: '浅色主题下选中行的底色，写进 [theme.custom]；留空 = 沿用主题自带的颜色。',
  },
  {
    key: 'active_row_bg_dark',
    label: '选中行底色（深色）',
    table: 'colors',
    kind: 'color',
    fallback: palette.chrome.dark.active_row_bg,
    help: '深色主题下选中行的底色；留空 = 沿用主题自带的颜色。',
  },
];

/* --------------------------------------------------------------- config */

function configFile() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR ?? pluginConfigDir(pluginId());
  return path.join(dir, 'config.toml');
}

function readConfig() {
  try {
    return fs.readFileSync(configFile(), 'utf8');
  } catch {
    return '';
  }
}

function currentValues(text) {
  const raw = config.parseToml(text);
  const values = new Map();
  for (const field of FIELDS) {
    if (field.virtual) {
      values.set(field, field.read());
      continue;
    }
    const holder = field.table ? (raw[field.table] ?? {}) : raw;
    values.set(field, holder[field.key] ?? field.legacy?.(raw));
  }
  return values;
}

// The Agents panel's two layers, in the order `agent-view --native` uses:
// rows first (config rewrite + reload, only when the panel choice changed),
// then the sort override, then the persisted choice. Herdr's own panel has
// no override at all, so `order` only means something while the rows are
// the plugin's; with the panel set to herdr the order is off, whatever the
// row said.
async function applyView({ panelOn, panelChanged, order }) {
  if (panelChanged) view.setRows(panelOn);
  const mode = panelOn ? ORDER_MODE[order] : null;
  const reply = mode ? await view.apply(mode) : await view.clear();
  if (!reply || reply.error) throw new Error('无法切换 Agents 面板的顺序');
  view.setMode(mode);
}

// TOML text for a value: numbers bare, everything else double-quoted.
function literal(value) {
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : `"${value}"`;
}

function saveValues(text, values) {
  const top = {};
  const tables = {};
  for (const [field, value] of values) {
    if (value === undefined || field.virtual) continue;
    if (field.table) (tables[field.table] ??= {})[field.key] = literal(value);
    else top[field.key] = literal(value);
  }
  let next = editTopLevel(text, top);
  for (const [table, edits] of Object.entries(tables)) {
    const edited = editTable(next, table, edits);
    next =
      edited ??
      `${next.replace(/\n*$/, '')}\n\n[${table}]\n${Object.entries(edits)
        .map(([k, v]) => `${k} = ${v}`)
        .join('\n')}\n`;
  }
  const file = configFile();
  ensureDir(path.dirname(file));
  writeAtomic(file, next, identity.TMP_SUFFIX);
}

/* ------------------------------------------------------------- display */

const R = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const INV = '\x1b[7m';
const ACCENT = '\x1b[38;5;110m';
const WARN = '\x1b[38;5;179m';

// A setting's name as the file spells it: `colors.active_row_bg_light` for a
// key inside a table.
function fieldName(field) {
  return field.table ? `${field.table}.${field.key}` : field.key;
}

function codepoint(ch) {
  return ch ? `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : '';
}

function show(field, value) {
  // Not set in the file: say what the default is, not just that it applies.
  if (value === undefined) return `${DIM}${show(field, field.fallback).replace(/\x1b\[[0-9;]*m/g, '')}  （默认）${R}`;
  switch (field.kind) {
    case 'bool':
      return value ? '开 (on)' : '关 (off)';
    case 'glyph':
      return value === '' ? `${DIM}无${R}` : `${codepoint(value)}  ${value}`;
    case 'color':
      return value === '' ? `${DIM}主题自带${R}` : String(value);
    default:
      return String(value);
  }
}

function width(s) {
  let w = 0;
  for (const ch of s.replace(/\x1b\[[0-9;]*m/g, '')) w += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));

// Break a sentence into lines no wider than `cols` columns. Chinese text has no
// spaces to break at, so the break is chosen by display width (lib/textwidth.js):
// at a space where there is one, between characters where there is not.
function wrap(text, cols, maxLines = HELP_ROWS) {
  return wrapByWidth(text, { first: cols, rest: cols, maxLines });
}

// The help sits in a fixed number of rows so the hint line below it does not
// jump as the cursor moves between short and long descriptions.
const HELP_ROWS = 2;

const BLANK_ABOVE_TITLE_ROWS = 1;
const TITLE_ROWS = 1;
const LIST_BOUNDARY_ROWS = 2;
const GAP_BELOW_HELP_ROWS = 1;
const KEY_HINT_ROWS = 1;
const TRAILING_NEWLINE_ROWS = 1;

// Every row of the popup that is not a setting.
const FIXED_ROWS =
  BLANK_ABOVE_TITLE_ROWS +
  TITLE_ROWS +
  LIST_BOUNDARY_ROWS +
  HELP_ROWS +
  GAP_BELOW_HELP_ROWS +
  KEY_HINT_ROWS +
  TRAILING_NEWLINE_ROWS;

const NAME_VALUE_GAP = 2;
// The column the value is padded to, so every label starts in one column.
const VALUE_COLS = 18;
const DEFAULT_POPUP_ROWS = 26;
const MINIMUM_LIST_ROWS = 3;
const STATUS_ROWS = 1;

// The name column fits the longest name, so every value starts in one column.
function nameColumnWidth() {
  return Math.max(...FIELDS.map((field) => width(fieldName(field)))) + NAME_VALUE_GAP;
}

// The list gets whatever the popup's height leaves over.
function listRoom(hasStatus) {
  let rows = (process.stdout.rows || DEFAULT_POPUP_ROWS) - FIXED_ROWS;
  if (hasStatus) rows -= STATUS_ROWS;
  return Math.max(MINIMUM_LIST_ROWS, rows);
}

// The visible rows scroll with the cursor; the hidden counts mark the rest.
function listWindow(cursor, room, top) {
  const nextTop = scrollTop(FIELDS.length, cursor, room, top);
  const hiddenAbove = nextTop;
  const hiddenBelow = Math.max(0, FIELDS.length - nextTop - room);
  return {
    top: nextTop,
    fields: FIELDS.slice(nextTop, nextTop + room),
    hiddenAbove,
    hiddenBelow,
  };
}

/* ---------------------------------------------------------------- editor */

class Editor {
  constructor() {
    this.text = readConfig();
    this.saved = currentValues(this.text);
    this.values = new Map(this.saved);
    this.cursor = 0;
    this.top = 0;
    this.editing = null; // { buffer } while typing a text value
    this.status = '';
    this.quitArmed = false;
  }

  get field() {
    return FIELDS[this.cursor];
  }

  effective(field) {
    const v = this.values.get(field);
    return v === undefined ? field.fallback : v;
  }

  dirty() {
    for (const field of FIELDS) if (this.values.get(field) !== this.saved.get(field)) return true;
    return false;
  }

  // Step the current field's value by direction (-1 / +1).
  step(dir) {
    const field = this.field;
    const cur = this.effective(field);
    if (field.kind === 'bool') return this.values.set(field, !cur);
    if (field.kind === 'enum') {
      const i = field.options.findIndex((o) => o === cur);
      const n = field.options.length;
      return this.values.set(field, field.options[((i < 0 ? 0 : i) + dir + n) % n]);
    }
    if (field.kind === 'number') {
      const next = Math.round((Number(cur) + dir * field.step) * 100) / 100;
      return this.values.set(field, Math.min(field.max, Math.max(field.min, next)));
    }
    return this.beginEdit();
  }

  beginEdit() {
    const field = this.field;
    const cur = this.effective(field);
    const buffer = field.kind === 'glyph' ? codepoint(cur) : String(cur);
    this.editing = { buffer };
  }

  commitEdit() {
    const field = this.field;
    const raw = this.editing.buffer.trim();
    this.editing = null;
    if (field.kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return (this.status = `${WARN}不是数字${R}`);
      return this.values.set(field, Math.min(field.max, Math.max(field.min, n)));
    }
    if (field.kind === 'glyph') {
      if (raw === '') return this.values.set(field, '');
      const hex = raw.match(/^U\+?([0-9a-f]{4,6})$/i)?.[1];
      const value = hex ? String.fromCodePoint(parseInt(hex, 16)) : [...raw][0];
      return this.values.set(field, value);
    }
    if (field.kind === 'color') {
      if (raw !== '' && !/^(#[0-9a-f]{6}|#[0-9a-f]{3}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|[a-z]+)$/i.test(raw)) {
        return (this.status = `${WARN}不是有效的颜色（十六进制、rgb(...) 或颜色名）${R}`);
      }
      return this.values.set(field, raw);
    }
    this.values.set(field, raw);
  }

  async save() {
    if (!this.dirty()) return (this.status = '没有改动');
    const panel = FIELDS.find((f) => f.key === 'agents_panel');
    const order = FIELDS.find((f) => f.key === 'order');
    const changed = (f) => this.values.get(f) !== this.saved.get(f);
    const viewChanged = changed(panel) || changed(order);
    const viewWanted = {
      panelOn: this.effective(panel) === 'plugin',
      panelChanged: changed(panel),
      order: this.effective(order),
    };
    try {
      saveValues(this.text, this.values);
    } catch (error) {
      return (this.status = `${WARN}写入失败：${error.message}${R}`);
    }
    this.status = '已保存 · 正在重启 daemon…';
    this.render();
    // The daemon reads its config once at start; restart it. Stop over the
    // pipe (it clears its tokens and exits), switch the panel while nothing
    // is painting, then start a fresh one with the environment Herdr gave this
    // popup, config directory included.
    const reply = await control.request({ cmd: 'stop' }, 10000);
    // A restart is what was asked for, so a daemon that answered but did not
    // leave is ended: the launcher below would otherwise find it still
    // answering, call it healthy, and keep the old settings running.
    if (reply?.ok && !(await state.waitForExit(4000))) {
      await state.terminate((await state.daemonStatus()).pid);
    }
    let note = '';
    if (viewChanged) {
      try {
        await applyView(viewWanted);
      } catch (error) {
        note = ` · ${WARN}${error.message}${R}`;
      }
    }
    detachedNode(path.join(__dirname, 'agent-state.js'));
    this.text = readConfig();
    this.saved = currentValues(this.text);
    this.values = new Map(this.saved);
    this.status = `已保存到 ${configFile()} · daemon 已重启${note}`;
  }

  render() {
    const cols = Math.max(60, (process.stdout.columns || 84) - 2);
    const keyW = nameColumnWidth();
    const visible = listWindow(this.cursor, listRoom(this.status), this.top);
    this.top = visible.top;
    const out = [''];
    // Title left, plugin id right, the gap between them measured — not
    // guessed — so the pair fits the popup's width exactly and never wraps.
    const title = `${identity.NAME} 设置`;
    const id = pluginId();
    out.push(` ${BOLD}${title}${R}${DIM}${' '.repeat(Math.max(1, cols - 1 - width(title) - width(id)))}${id}${R}`);
    out.push(visible.hiddenAbove ? `   ${DIM}↑ 上面还有 ${visible.hiddenAbove} 项${R}` : '');
    visible.fields.forEach((field, offset) => {
      const selected = visible.top + offset === this.cursor;
      const changed = this.values.get(field) !== this.saved.get(field);
      const name = fieldName(field);
      const value =
        selected && this.editing ? `${INV}${this.editing.buffer}${R}${DIM}▏${R}` : show(field, this.values.get(field));
      const marker = changed ? `${WARN}*${R}` : ' ';
      const row = `${marker} ${pad(name, keyW)} ${pad(value, VALUE_COLS)} ${DIM}${field.label ?? ''}${R}`;
      out.push(selected ? ` ${ACCENT}▸${R} ${BOLD}${row}${R}` : `   ${row}`);
    });
    out.push(visible.hiddenBelow ? `   ${DIM}↓ 下面还有 ${visible.hiddenBelow} 项${R}` : '');
    const help = wrap(this.field.help, cols - 1).slice(0, HELP_ROWS);
    while (help.length < HELP_ROWS) help.push('');
    for (const line of help) out.push(` ${DIM}${line}${R}`);
    out.push('');
    out.push(
      this.editing
        ? ` ${DIM}输入数值 · ↵ 确认 · esc 取消${R}`
        : ` ${DIM}↑↓ 选择 · ←→ 修改 · ↵ 编辑 · r 恢复默认 · s 保存并生效 · q 关闭${R}`,
    );
    if (this.status) out.push(` ${this.status}`);
    process.stdout.write('\x1b[2J\x1b[H' + out.join('\n') + '\n');
  }

  async key(k) {
    this.status = '';
    if (this.editing) {
      if (k === '\r') this.commitEdit();
      else if (k === '\x1b') this.editing = null;
      else if (k === '\x7f' || k === '\b') this.editing.buffer = this.editing.buffer.slice(0, -1);
      else if (k >= ' ' && !k.startsWith('\x1b')) this.editing.buffer += k;
      return this.render();
    }
    if (k === 'q' || k === '\x1b' || k === '\x03') {
      if (this.dirty() && !this.quitArmed) {
        this.quitArmed = true;
        this.status = `${WARN}有未保存的修改 —— 再按一次 q 放弃，按 s 保存${R}`;
        return this.render();
      }
      process.stdout.write('\x1b[2J\x1b[H');
      process.exit(0);
    }
    this.quitArmed = false;
    if (k === '\x1b[A' || k === 'k') this.cursor = (this.cursor + FIELDS.length - 1) % FIELDS.length;
    else if (k === '\x1b[B' || k === 'j') this.cursor = (this.cursor + 1) % FIELDS.length;
    else if (k === '\x1b[C' || k === 'l' || k === ' ' || k === '+') this.step(1);
    else if (k === '\x1b[D' || k === 'h' || k === '-') this.step(-1);
    else if (k === '\r') this.field.kind === 'bool' || this.field.kind === 'enum' ? this.step(1) : this.beginEdit();
    else if (k === 'r') this.values.set(this.field, undefined);
    else if (k === 's') await this.save();
    this.render();
  }
}

/* ----------------------------------------------------------------- main */

function openPopup() {
  const herdr = process.env.HERDR_BIN_PATH ?? 'herdr';
  // `--cwd` is not optional on Windows: left to Herdr, the pane's cwd is the
  // plugin root as an extended-length `\\?\C:\...` path, which a Git Bash
  // pane shell cannot enter — the pane exits in ~40 ms before `node` ever
  // runs, and the popup just flashes. A plain path from here works everywhere.
  const root = path.resolve(__dirname, '..');
  const result = spawnSync(
    herdr,
    ['plugin', 'pane', 'open', '--plugin', pluginId(), '--entrypoint', 'settings', '--cwd', root],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'could not open the settings popup\n');
    process.exit(1);
  }
}

// A popup that dies takes its stderr with it, so anything fatal also goes to
// a file next to the daemon's log.
function crashLog(text) {
  try {
    fs.appendFileSync(path.join(ensureDir(stateRoot), 'settings.err'), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // Nothing else to do.
  }
}

function main() {
  if (process.argv.includes('--open')) return openPopup();
  if (!process.stdin.isTTY) {
    crashLog(`no tty: stdin.isTTY=${process.stdin.isTTY} stdout.isTTY=${process.stdout.isTTY} cwd=${process.cwd()}`);
    console.error('settings: needs a terminal (Herdr opens it as a popup; try --open)');
    process.exit(1);
  }
  const editor = new Editor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (k) => {
    editor.key(String(k)).catch((error) => {
      editor.status = `${WARN}${error.message}${R}`;
      editor.render();
    });
  });
  process.stdout.on('resize', () => editor.render());
  editor.render();
}

if (require.main === module) {
  process.on('uncaughtException', (error) => {
    crashLog(error?.stack ?? String(error));
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    crashLog(error?.stack ?? String(error));
    process.exit(1);
  });

  try {
    main();
  } catch (error) {
    crashLog(error?.stack ?? String(error));
    throw error;
  }
} else {
  // Loaded by a test: expose the schema and the help layout, run nothing.
  module.exports = { FIELDS, HELP_ROWS, helpLines: wrap };
}
