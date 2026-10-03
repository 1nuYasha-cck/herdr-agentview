'use strict';

// The `entry` layout makes every agent a self-contained sidebar entry: a title
// row and a project row, with no group header and no spacer riding on its
// neighbours. Selecting an agent highlights all rows of its own entry, so any
// row that belongs to another agent leaks into the selection.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const managed = require('../lib/managed-config');
const state = require('../lib/state');
const herdr = require('../lib/herdr');

function withLayout(layout, fn) {
  const before = config.layout;
  config.layout = layout;
  try {
    return fn();
  } finally {
    config.layout = before;
  }
}

test('entry layout carries a project row and no group header or spacer', () => {
  const block = withLayout('entry', () => managed.sidebarBlock('dark'));
  assert.match(block, /# layout: entry/);
  assert.match(block, /"\$project"/);
  assert.match(block, /"\$project_stale"/);
  assert.doesNotMatch(block, /"\$group"/);
  assert.doesNotMatch(block, /"\$group_parent"/);
  assert.doesNotMatch(block, /"\$gap"/);
});

test('grouped layout is radar\'s: header rows and a spacer, no project row', () => {
  const block = withLayout('grouped', () => managed.sidebarBlock('dark'));
  assert.match(block, /# layout: grouped/);
  assert.match(block, /"\$group"/);
  assert.match(block, /"\$gap"/);
  assert.doesNotMatch(block, /"\$project"/);
});

test('blockLayout reads the tag back', () => {
  const block = withLayout('entry', () => managed.sidebarBlock('light'));
  assert.equal(managed.blockLayout(block), 'entry');
  assert.equal(managed.blockLayout('nothing here'), null);
});

test('the Spaces list gets one row per agent slot and an overflow row', () => {
  const block = managed.sidebarBlock('dark');
  const spaces = block.slice(block.indexOf('[ui.sidebar.spaces]'));
  for (let slot = 1; slot <= config.spaceAgents; slot += 1) {
    assert.match(spaces, new RegExp(`"\\$space_a${slot}_logo"`));
    assert.match(spaces, new RegExp(`"\\$space_a${slot}_working"`));
  }
  assert.match(spaces, /"\$space_more"/);
});

test('spaceAgentTokens lists every agent, most urgent first, with its own state', () => {
  const agents = [
    { display: 'idle', name: 'codex', title: 'parked task' },
    { display: 'working', name: 'claude', title: 'fix the login page' },
    { display: 'blocked', name: 'claude', title: 'which env file?' },
  ];
  const out = state.spaceAgentTokens(agents);
  assert.match(out.space_a1_blocked, /which env file\?$/);
  assert.match(out.space_a2_working, /fix the login page$/);
  assert.match(out.space_a3_idle, /parked task$/);
  assert.equal(out.space_a1_working, null, 'only the agent\'s own state token is set');
  assert.equal(out.space_a4_idle, null);
  assert.equal(out.space_more, null);
});

test('more agents than slots are counted, not dropped silently', () => {
  const agents = Array.from({ length: 7 }, (_, i) => ({ display: 'idle', name: 'codex', title: `t${i}` }));
  const out = state.spaceAgentTokens(agents, 4);
  assert.equal(out.space_more, '+3');
  assert.ok(out.space_a4_idle);
  assert.equal(out.space_a5_idle, undefined);
});

test('every idle tier shares the one idle slot token', () => {
  const out = state.spaceAgentTokens([
    { display: 'idle_fresh', name: 'codex', title: 'a' },
    { display: 'idle_stale', name: 'codex', title: 'b' },
  ]);
  assert.ok(out.space_a1_idle);
  assert.ok(out.space_a2_idle);
});

test('writeProjects labels every entry and fades a stale workspace', async (t) => {
  const written = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    written.push([pane, tokens]);
    return true;
  });
  const entries = [
    { pane: 'p1', workspace: 'w1' },
    { pane: 'p2', workspace: 'w1' },
    { pane: 'p3', workspace: 'w2' },
  ];
  const labels = new Map([
    ['w1', 'web'],
    ['w2', 'api'],
  ]);
  const result = await state.writeProjects('plugin:x', entries, labels, new Set(['w2']));
  assert.equal(result.ok, true);
  const byPane = Object.fromEntries(written);
  assert.equal(byPane.p1.project, 'web');
  assert.equal(byPane.p2.project, 'web', 'every member carries the project, not only the first');
  assert.equal(byPane.p3.project, null);
  assert.equal(byPane.p3.project_stale, 'api');
  assert.equal(byPane.p1.group, null, 'group furniture from the other layout is cleared');
});

test('a working agent turns the spinner in the Spaces row, a blocked one pulses', () => {
  const config = require('../lib/config');
  const frames = new Set([0, 1, 2, 3].map((step) => state.spaceLead('working', step)));
  assert.ok(frames.size > 1, 'the working mark must change from step to step');
  for (const frame of frames) assert.ok(config.FRAMES.includes(frame));
  assert.equal(state.spaceLead('idle', 0), state.spaceLead('idle', 5), 'an idle mark does not move');
  const a = state.spaceAgentTokens([{ display: 'working', name: 'claude', title: 'x' }], 4, 0);
  const b = state.spaceAgentTokens([{ display: 'working', name: 'claude', title: 'x' }], 4, 1);
  assert.notEqual(a.space_a1_working, b.space_a1_working);
});

test('a step of the spinner changes only the tokens that move', () => {
  const agents = [
    { display: 'working', name: 'claude', title: 'fix it' },
    { display: 'idle', name: 'codex', title: 'parked' },
  ];
  const one = state.spaceTokenSet('space_working_other', state.spaceLead('working', 0), state.spaceAgentTokens(agents, 4, 0), 'web');
  const two = state.spaceTokenSet('space_working_other', state.spaceLead('working', 1), state.spaceAgentTokens(agents, 4, 1), 'web');
  const delta = state.tokenDelta(two, one);
  assert.deepEqual(Object.keys(delta).sort(), ['space_a1_working', 'space_working_other']);
});

test('the machine name has a row of its own, apart from the title', () => {
  for (const layout of ['entry', 'grouped']) {
    const block = withLayout(layout, () => managed.sidebarBlock('dark'));
    const agents = block.slice(block.indexOf('[ui.sidebar.agents]'), block.indexOf('[ui.sidebar.agents.rows_by_agent]'));
    // Every top-level row of the default Agents row, as cell lists.
    const body = agents.slice(agents.indexOf('rows = ['));
    const rows = [];
    let depth = 0;
    let from = 0;
    for (let i = body.indexOf('['); i < body.length; i += 1) {
      if (body[i] === '[') {
        if (depth === 1) from = i;
        depth += 1;
      } else if (body[i] === ']') {
        depth -= 1;
        if (depth === 1) rows.push(body.slice(from, i + 1));
        if (depth === 0) break;
      }
    }
    const withMachine = rows.filter((row) => row.includes('token = "machine"'));
    assert.equal(withMachine.length, 1, `${layout}: one row carries the machine`);
    assert.doesNotMatch(withMachine[0], /\$title|\$logo|\$project|\$git/, `${layout}: nothing else shares its row`);
    const titleRow = rows.find((row) => row.includes('$title_working'));
    assert.doesNotMatch(titleRow, /token = "machine"/, `${layout}: the title row keeps its width`);
  }
});

test('in the entry layout the machine row is the first row', () => {
  const block = withLayout('entry', () => managed.sidebarBlock('dark'));
  const agents = block.slice(block.indexOf('[ui.sidebar.agents]'), block.indexOf('[ui.sidebar.agents.rows_by_agent]'));
  assert.ok(agents.indexOf('token = "machine"') < agents.indexOf('$title_working'));
  assert.ok(agents.indexOf('token = "machine"') < agents.indexOf('$split_mark'));
});

test('the gap between agent entries is Herdr\'s row_gap, tagged so a change regenerates the block', () => {
  const original = config.agentRowGap;
  for (const gap of [0, 1, 2]) {
    config.agentRowGap = gap;
    const block = managed.sidebarBlock('dark');
    const agents = block.slice(block.indexOf('[ui.sidebar.agents]'), block.indexOf('[ui.sidebar.agents.rows_by_agent]'));
    assert.match(agents, new RegExp(`^row_gap = ${gap}$`, 'm'));
    assert.equal(managed.blockRowGap(block), String(gap));
  }
  config.agentRowGap = original;
  assert.equal(managed.blockRowGap('nothing'), null);
  assert.equal(config.agentRowGap, 0, 'there is no gap by default');
});

test('the machine row is the first row in the grouped layout too', () => {
  const block = withLayout('grouped', () => managed.sidebarBlock('dark'));
  const agents = block.slice(block.indexOf('[ui.sidebar.agents]'), block.indexOf('[ui.sidebar.agents.rows_by_agent]'));
  assert.ok(agents.indexOf('token = "machine"') < agents.indexOf('$group_parent'));
  assert.ok(agents.indexOf('token = "machine"') < agents.indexOf('$title_working'));
  // The spacer is still the last row of the entry, below the Git row.
  assert.ok(agents.lastIndexOf('"$gap"') > agents.lastIndexOf('$git_branch'));
});

test('a head entry\'s title loses the two columns Herdr indents a later row by', () => {
  const saved = { titleWrap: config.titleWrap, titleWidth: config.titleWidth, titleMargin: config.titleMargin };
  Object.assign(config, { titleWrap: 4, titleWidth: 35, titleMargin: 0 });
  try {
    const { displayWidth } = require('../lib/textwidth');
    const long = 'refactor the authentication middleware so sessions survive a restart';
    assert.equal(state.CONTINUATION_EXTRA, 2);
    const member = state.titleLines(long, '⣾ ', 0);
    const head = state.titleLines(long, '⣾ ', state.CONTINUATION_EXTRA);
    // 35 columns, 10 of overhead, the 2-column spinner prefix and, for the head, 2 more.
    assert.ok(displayWidth(member[0]) <= 35 - 10 - 2, member[0]);
    assert.ok(displayWidth(head[0]) <= 35 - 10 - 2 - 2, head[0]);
    assert.ok(displayWidth(head[0]) <= displayWidth(member[0]), 'the head wraps no later than a member');
    // The tokens carry it: the flag changes where the first line breaks.
    const line = { mark: '', split: '', logo: '', titlePrefix: '⣾ ' };
    const asHead = state.stateTokens('working', line, long, null, { headTitle: true });
    const asMember = state.stateTokens('working', line, long, null, { headTitle: false });
    assert.ok(asHead.title_working.length <= asMember.title_working.length);
  } finally {
    Object.assign(config, saved);
  }
});

test('there is no blank row between groups unless group_gap is asked for', () => {
  assert.equal(config.groupGap, false, 'the spacer after each group is off by default');
});
