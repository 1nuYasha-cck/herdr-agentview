'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const managed = require('../lib/managed-config');
const state = require('../lib/state');
const { displayWidth } = require('../lib/textwidth');

function withConfig(changes, fn) {
  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, config[key]]));
  Object.assign(config, changes);
  try {
    return fn();
  } finally {
    Object.assign(config, before);
  }
}

const LONG = 'refactor the authentication middleware so sessions survive a restart';

test('a long title wraps onto several rows within the width', () => {
  withConfig({ titleWrap: 3, titleWidth: 32, titleMargin: 0 }, () => {
    const lines = state.titleLines(LONG, '⣷ ');
    assert.ok(lines.length >= 2 && lines.length <= 3, `got ${lines.length} lines`);
    assert.ok(displayWidth(`⣷ ${lines[0]}`) <= 32 - 10, lines[0]);
    for (const line of lines.slice(1)) assert.ok(displayWidth(line) <= 32 - 8, line);
  });
});

test('title_wrap = 1 keeps one row', () => {
  withConfig({ titleWrap: 1 }, () => assert.deepEqual(state.titleLines(LONG), [LONG]));
});

test('a short title stays on its single row', () => {
  withConfig({ titleWrap: 3, titleWidth: 32 }, () => assert.deepEqual(state.titleLines('fix login'), ['fix login']));
});

test('title_margin narrows the wrap', () => {
  const wide = withConfig({ titleWrap: 4, titleWidth: 32, titleMargin: 0 }, () => state.titleLines(LONG));
  const narrow = withConfig({ titleWrap: 4, titleWidth: 32, titleMargin: 6 }, () => state.titleLines(LONG));
  assert.ok(narrow.length >= wide.length);
});

test('continuation tokens carry the current state only', () => {
  withConfig({ titleWrap: 3, titleWidth: 32, titleMargin: 0 }, () => {
    const line = { mark: '', split: '', logo: '', titlePrefix: '' };
    const tokens = state.stateTokens('working', line, LONG);
    assert.ok(tokens.title_working);
    assert.ok(tokens.title2_working);
    assert.equal(tokens.title_idle, null);
    assert.equal(tokens.title2_idle, null);
    // A short title leaves every continuation token cleared.
    const short = state.stateTokens('working', line, 'fix login');
    assert.equal(short.title2_working, null);
    assert.equal(short.title3_working, null);
  });
});

test('every continuation family is in the block, whatever title_wrap says', () => {
  const block = withConfig({ titleWrap: 1 }, () => managed.sidebarBlock('dark'));
  for (let row = 2; row <= config.titleLinesMax; row += 1) assert.match(block, new RegExp(`"\\$title${row}_working"`));
});
