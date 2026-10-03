'use strict';

// The plugin's own config file, and the glyph/behaviour choices read out of it.
//
// Herdr hands plugin commands HERDR_PLUGIN_CONFIG_DIR; config.toml inside it is
// optional and every key has a default, so a missing or malformed file degrades
// to upstream behaviour rather than failing.

const fs = require('node:fs');
const path = require('node:path');

const paths = require('./paths');

// A subset TOML reader: scalars and one level of `[table]`. The file this parses
// is a handful of keys the user writes by hand, so a dependency-free reader is
// worth more than full spec coverage — and Node ships no TOML parser.

// Everything before the first `#` that is not inside a quoted string. A
// quoted value may contain `#` — every hex colour does.
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseToml(text) {
  const root = {};
  let table = root;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim().replace(/^"|"$/g, '');
      if (typeof root[name] !== 'object' || root[name] === null) root[name] = {};
      table = root[name];
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^"|"$/g, '');
    const value = line.slice(eq + 1).trim();
    if (!key || !value) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      table[key] = value.slice(1, -1);
    } else if (value === 'true' || value === 'false') {
      table[key] = value === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      table[key] = Number(value);
    } else {
      table[key] = value;
    }
  }
  return root;
}

// Herdr injects HERDR_PLUGIN_CONFIG_DIR into the commands it starts, so an
// action or a startup hook is told where its config lives. Nothing tells a
// process started by hand — `node bin/agent-state.js` from a checkout, which
// is how this plugin is developed and how the README's own recovery step is
// worded — and without a fallback such a daemon quietly ran on defaults:
// every setting the user had chosen, from the glyph variant to the freshness
// thresholds, silently ignored. lib/paths derives the same location the way
// Herdr lays it out.
function load() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR ?? paths.pluginConfigDir(paths.pluginId());
  try {
    return parseToml(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'));
  } catch {
    return {};
  }
}

const raw = load();


// `row_label` when it names a mode. Without it, the older `show_tab = true`
// reads as `both` and anything else as `title`.
function rowLabelSetting() {
  if (['title', 'tab', 'both'].includes(raw.row_label)) return raw.row_label;
  if (raw.show_tab === true) return 'both';
  return 'title';
}
const glyphs = typeof raw.glyphs === 'object' && raw.glyphs !== null ? raw.glyphs : {};

function glyph(state, fallback) {
  const chosen = glyphs[state];
  if (typeof chosen === 'string' && chosen) return chosen;
  // `led_glyph` is upstream's single knob for the blocked/idle mark; honour it
  // so an existing config keeps working.
  if ((state === 'blocked' || state === 'idle') && typeof raw.led_glyph === 'string' && raw.led_glyph) {
    return raw.led_glyph;
  }
  return fallback;
}

// What the user actually wrote for a state, or undefined. `logos.js` needs the
// difference between "chose this mark" and "took the default": the default now
// depends on the variant, an explicit choice never does.
function userGlyph(state) {
  return glyph(state, undefined);
}

// Every state gets its own shape, not just its own colour. Upstream draws
// blocked, idle and unknown with one mark and its suggested row config gives
// idle and unknown the same colour too, so three different situations look
// identical — in a light theme, in a screenshot, or to anyone who does not
// separate those hues easily.
const STATIC_GLYPH = {
  done: glyph('done', '✓'),
  blocked: glyph('blocked', '?'), // it is asking you something
  // The three idle tiers share one mark and differ only in colour; see the
  // note on STATE_PUA in lib/logos.js. Same here, so a font-less terminal
  // shows the same design rather than a second, older one. `working` shares
  // it too — its motion lives on the logo now, not on a spinner here.
  working: glyph('working', '○'),
  idle: glyph('idle', '·'), // parked, nothing wrong
  unknown: glyph('unknown', '◌'), // could not tell
  idle_fresh: glyph('idle_fresh', '·'), // worked recently
  idle_stale: glyph('idle_stale', '·'), // untouched for hours
};

// Spinner frames for `working`: eight-dot braille, the gap walking round a
// full cell. Two lighter designs were tried in front of these and both were
// put back — six-dot braille, which loses the lower row and reads thinner
// than the text beside it, and a twelve-spoke throbber baked into the icon
// font, which only a terminal with that font could show. A full braille cell
// is the heaviest mark of the three and the one that reads as motion from the
// other side of the panel, which is the entire job. The throbber's glyphs left
// the font with it — an unused mark is one more thing to keep building.
const FRAMES = ['⣷', '⣯', '⣟', '⡿', '⢿', '⣻', '⣽', '⣾'];

const holdSetting = raw.done_hold ?? 'until_seen';
const colors = typeof raw.colors === 'object' && raw.colors !== null ? raw.colors : {};

module.exports = {
  raw,
  parseToml,
  STATIC_GLYPH,
  userGlyph,
  FRAMES,

  // Whether the plugin polls the desktop's light/dark appearance and drives
  // Herdr's `[theme] name` from it. Off, Herdr's own `[theme]` settings decide
  // and the plugin's colours follow whichever theme name is configured.
  followAppearance: raw.follow_appearance !== false,

  // `[colors]` overrides for the one Herdr chrome token the theme block sets.
  // A string (hex, named, rgb(...)) replaces the default for that appearance;
  // an empty string means "do not override — let the theme's own value show".
  // Absent means the default.
  activeRowBg: {
    light: typeof colors.active_row_bg_light === 'string' ? colors.active_row_bg_light : undefined,
    dark: typeof colors.active_row_bg_dark === 'string' ? colors.active_row_bg_dark : undefined,
  },

  // auto | font | text | none
  variant: typeof raw.variant === 'string' ? raw.variant : 'auto',

  // How long the green check survives after a turn ends. Herdr collapses `done`
  // into `idle` almost immediately, so the badge is this plugin's own
  // invention; six seconds is easy to miss when several agents finish while you
  // are looking elsewhere.
  doneHoldUntilSeen: holdSetting === 'until_seen',
  doneHoldSeconds: typeof holdSetting === 'number' ? holdSetting : 6,

  // How long an idle/done report has to persist before it counts as a turn
  // end. Herdr's detection can flap to idle for a beat mid-turn (macOS); the
  // grace absorbs it. Zero disables.
  idleGraceMs: (typeof raw.idle_grace_seconds === 'number' ? raw.idle_grace_seconds : 2.5) * 1000,

  // Whether a question mark survives until the agent goes back to work.
  // Herdr recognises `blocked` from the shape of the question on screen, so
  // focusing the pane can redraw it out of recognition — the question is still
  // waiting, but the mark is gone. Seeing a question is not answering it:
  // glancing at a pane and coming back to it later is the normal case.
  blockedHoldUntilAnswered: raw.blocked_hold !== false,

  // How long an idle pane keeps reading as recently active, and when it starts
  // reading as abandoned. Herdr has no notion of either — `idle` is `idle`
  // whether the agent stopped a minute ago or on Tuesday — so these two
  // thresholds are what turn one state into three.
  activityFreshMs: (typeof raw.activity_fresh_minutes === 'number' ? raw.activity_fresh_minutes : 15) * 60000,
  activityStaleMs: (typeof raw.activity_stale_minutes === 'number' ? raw.activity_stale_minutes : 120) * 60000,

  // What names an agent row: `title`, `tab` or `both`.
  rowLabel: rowLabelSetting(),

  trimGroupPrefix: raw.trim_group_prefix !== false,
  // Off by default: a blank row after each group opened a gap between agents.
  groupGap: raw.group_gap === true,
  // How an agent appears in the Agents list. `entry`: every agent is a
  // self-contained entry (a title row, then a project row), so selecting one
  // highlights only its own rows. `grouped`: radar's layout, a workspace header
  // row riding on the first agent of each group and a spacer on the last, which
  // a selection of either of those agents takes along.
  layout: raw.layout === 'grouped' ? 'grouped' : 'entry',
  // Blank rows between two agent entries (Herdr's `row_gap` for the Agents list).
  // Herdr draws the gap outside an entry, so a selection never includes it.
  agentRowGap: typeof raw.agent_row_gap === 'number' ? Math.max(0, Math.min(2, Math.floor(raw.agent_row_gap))) : 0,
  // A long title wraps onto up to this many rows instead of being cut with an
  // ellipsis (Herdr never wraps; lib/textwidth.js does it by splitting the
  // title across rows). 1 turns wrapping off.
  // The rows a title may wrap onto, the first included. The sidebar block and
  // the published tokens both have this many families, whatever `title_wrap` says.
  titleLinesMax: 4,
  titleWrap: typeof raw.title_wrap === 'number' ? Math.max(1, Math.min(4, Math.floor(raw.title_wrap))) : 3,
  // The width titles wrap at, in columns. It is a setting, not a reading: the
  // plugin does not look at the sidebar. The default is the sidebar's current
  // maximum width; change it here when the sidebar's width changes.
  titleWidth: typeof raw.title_width === 'number' && raw.title_width > 0 ? Math.floor(raw.title_width) : 32,
  // Columns a row loses before its text starts (mark, logo, separators, the
  // margins), and an adjustment for the terminal in use. Positive narrows the
  // wrap, negative widens it.
  titleMargin: typeof raw.title_margin === 'number' ? Math.floor(raw.title_margin) : 0,

  // Where this machine's agents sit in the Agents list when several machines
  // are shown together: lower numbers first. Herdr has no sort field for the
  // machine, so each machine's plugin publishes its rank as a token and the
  // sort puts that token first (lib/view.js). Give every machine a different
  // number; machines left at 0 interleave by activity, as before.
  machineRank: typeof raw.machine_rank === 'number' ? Math.max(0, Math.min(9, Math.floor(raw.machine_rank))) : 0,

  // How many of a workspace's agents the Spaces list names, one row each, most
  // urgent first; the rest are counted as `+N`. 0 shows the vendor logos on one
  // row instead, which is radar's Spaces list.
  spaceAgents: typeof raw.space_agents === 'number' ? Math.max(0, Math.min(6, Math.floor(raw.space_agents))) : 4,
  // Off by default (#17): a split is two peers sharing one tab, and the
  // corner read as a parent/child and cost the row width.
  splitCorner: raw.split_corner === true,
  groupIndentWidth: typeof raw.group_indent === 'number' ? raw.group_indent : 2,

  // Keep Herdr's actual workspace indices aligned with Radar's activity order
  // so prefix+shift+1..9 follows the same order as the Agents panel. This is
  // opt-in because it changes the global Spaces order, not just this plugin's view.
  reorderWorkspaces: raw.reorder_workspaces === true,

  // The mark on a worktree's group header, between the branch corner and the
  // branch name. Deliberately NOT one of our own PUA glyphs: a Nerd Font as
  // the terminal's PRIMARY family already carries the git marks, and primary
  // beats fallback. Owning it would mean a font rebuild, a reinstall on every
  // machine and a wider `font-codepoint-map` range — for a decorative glyph.
  //
  // U+F418 is Octicons' git-branch, chosen over the Powerline symbol (U+E0A0),
  // Devicons' git-branch (U+E725) and Font Awesome's code-fork (U+F126) after
  // looking at all four on a real sidebar; every one of them rendered, so this
  // was taste, not coverage. Written as an escape on purpose — a PUA character
  // pasted in literally is invisible in the source and in every diff of it.
  // The bet is on the primary font being a Nerd Font; where it is not, set
  // `worktree_mark` to another codepoint (or "" to drop the mark) — no code
  // change needed.
  worktreeMark: typeof raw.worktree_mark === 'string' ? raw.worktree_mark : '\uf418',

  // The third row of an agent's entry: its Git branch, with a different mark for
  // a linked worktree. `always` shows it in any repository, `auto` only in a
  // worktree or off the main branch, `off` never. The tab bar always shows the
  // branch. Both marks are Nerd Font glyphs; "" drops one.
  gitRow: ['always', 'auto', 'off'].includes(raw.git_row) ? raw.git_row : 'always',
  gitBranchMark: typeof raw.git_branch_mark === 'string' ? raw.git_branch_mark : '\ue0a0',
  gitWorktreeMark: typeof raw.git_worktree_mark === 'string' ? raw.git_worktree_mark : '\uf418',

  // Path of an optional module that may rewrite what is displayed before it
  // is published (lib/hook.js). Absent by default; the plugin ships none.
  renderHook: typeof raw.render_hook === 'string' && raw.render_hook ? raw.render_hook : null,
};
