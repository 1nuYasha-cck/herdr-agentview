'use strict';

// Herdr has no sort field for the machine, so the Agents list puts a token of
// ours first: every machine's plugin publishes its rank as `machine_key`, and
// the view sorts on it before anything else. Without it two machines' entries
// were compared on workspace ids that are only meaningful per server (`wN`
// against `w13`), which put a remote agent between local ones.

const test = require('node:test');
const assert = require('node:assert/strict');

const view = require('../lib/view');

// The comparison Herdr runs over an entry's tokens (src/agent_view_eval.rs):
// field by field, a missing value sorts last, ties fall through to the next.
function sorted(entries, spec) {
  return [...entries].sort((left, right) => {
    for (const { field, order } of spec.sort) {
      const a = left.tokens[field.token];
      const b = right.tokens[field.token];
      if (a === b) continue;
      if (a === undefined) return 1;
      if (b === undefined) return -1;
      return (a < b ? -1 : 1) * (order === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

const entry = (name, machine, ws, activity = '000000000000') => ({
  name,
  tokens: {
    machine_key: machine,
    ws_key: `${activity}-${ws}-1`,
    tab_key: `${activity}-${ws}:t1-1`,
    ...(activity === '000000000000' ? {} : { sort_key: activity }),
  },
});

// The data from the failing case: three local idle workspaces, one remote idle
// workspace whose id `wN` sorts between `wS` and `w13`, and two active locals.
const ENTRIES = [
  entry('local maintain', '00', 'wS'),
  entry('local search', '00', 'wZ'),
  entry('local skills', '00', 'w13'),
  entry('local busy', '00', 'w0', '000029850466'),
  entry('macbook codex', '01', 'wN'),
  entry('macbook busy', '01', 'wM', '000029850470'),
];

test('the machine key leads the sort, ahead of every activity key', () => {
  for (const mode of ['grouped', 'recent']) {
    const spec = view.sortFor(mode, 0);
    assert.equal(spec.sort[0].field.token, 'machine_key');
    assert.ok(spec.sort.length >= 2, 'the activity order is kept below it');
  }
  assert.equal(view.sortFor('nope', 0), null);
});

test('the lowest rank sorts ascending, any other descending, so a machine puts itself first', () => {
  assert.equal(view.sortFor('grouped', 0).sort[0].order, 'asc');
  assert.equal(view.sortFor('grouped', 1).sort[0].order, 'desc');
  assert.equal(view.sortFor('grouped', 3).sort[0].order, 'desc');
});

test('viewed from the machine at rank 0, its agents come first and the other machine follows', () => {
  const names = sorted(ENTRIES, view.sortFor('grouped', 0)).map((e) => e.name);
  assert.deepEqual(names.slice(0, 4).sort(), ['local busy', 'local maintain', 'local search', 'local skills']);
  assert.deepEqual(names.slice(4).sort(), ['macbook busy', 'macbook codex']);
  assert.equal(names[0], 'local busy', 'within a machine the busiest still leads');
  assert.equal(names[4], 'macbook busy');
});

test('viewed from the machine at rank 1, its own agents come first', () => {
  const names = sorted(ENTRIES, view.sortFor('grouped', 1)).map((e) => e.name);
  assert.deepEqual(names.slice(0, 2), ['macbook busy', 'macbook codex']);
  assert.ok(names.slice(2).every((name) => name.startsWith('local')));
});

test('a remote agent no longer lands between two local workspaces', () => {
  const names = sorted(ENTRIES, view.sortFor('grouped', 0)).map((e) => e.name);
  const remote = names.findIndex((name) => name.startsWith('macbook'));
  assert.ok(names.slice(0, remote).every((name) => name.startsWith('local')));
  assert.ok(names.slice(remote).every((name) => name.startsWith('macbook')));
});

test('a machine without the plugin publishes no key and goes after the ones that do', () => {
  const bare = { name: 'no plugin', tokens: {} };
  const names = sorted([bare, ...ENTRIES], view.sortFor('grouped', 0)).map((e) => e.name);
  assert.equal(names.at(-1), 'no plugin');
});
