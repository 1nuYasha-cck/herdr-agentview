'use strict';

// Herdr rejects a whole config file when one sidebar row names more than 16
// tokens, and that takes every plugin down with it. radar 1.4.0 shipped a
// Spaces row with 18; these hold every generated row under the ceiling for
// both appearances.

const test = require('node:test');
const assert = require('node:assert/strict');

const managed = require('../lib/managed-config');
const palette = require('../lib/palette');
const state = require('../lib/state');

const LIMIT = 16;
const tokensIn = (row) => (row.match(/token = "/g) ?? []).length + (row.match(/(?<![:=] )"\$\w+"/g) ?? []).length;

// The top-level `[ ... ]` rows of one `rows = [ ... ]` assignment.
function rowsOf(block, table) {
  const start = block.indexOf(`[${table}]`);
  const body = block.slice(block.indexOf('rows = [', start));
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
  return rows;
}

for (const variant of ['light', 'dark']) {
  test(`every Spaces row stays within the token limit (${variant})`, () => {
    const rows = rowsOf(managed.sidebarBlock(variant), 'ui.sidebar.spaces');
    assert.ok(rows.length >= 2);
    for (const row of rows) assert.ok(tokensIn(row) <= LIMIT, `a Spaces row names ${tokensIn(row)} tokens`);
  });

  test(`the Agents row stays within the token limit and carries machine (${variant})`, () => {
    const rows = rowsOf(managed.sidebarBlock(variant), 'ui.sidebar.agents');
    for (const row of rows) assert.ok(tokensIn(row) <= LIMIT, `an Agents row names ${tokensIn(row)} tokens`);
    const block = managed.sidebarBlock(variant);
    assert.match(block, /token = "machine"[^}]*rules = \[\{ equals = "Local", hide = true \}\]/);
  });
}

test('a vendor without its own Spaces working colour shares the generic one', () => {
  const beyond = palette.brandVendors.find((vendor) => !palette.spaceWorkingVendors.includes(vendor));
  assert.ok(beyond, 'the roster no longer exceeds the Spaces limit; this guard can go');
  assert.equal(state.spaceToken('working', beyond), 'space_working_other');
  assert.equal(state.spaceToken('working', palette.spaceWorkingVendors[0]), `space_working_${palette.spaceWorkingVendors[0]}`);
});
