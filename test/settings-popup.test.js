'use strict';

// The settings popup is a small terminal screen, so its text has to fit it:
// every setting carries a Chinese label and a Chinese description, the
// description fits the two help rows without being cut, and a row with its
// label fits the popup's width. Chinese characters take two columns each.

const test = require('node:test');
const assert = require('node:assert/strict');

const { FIELDS, HELP_ROWS, helpLines } = require('../bin/settings');
const { displayWidth } = require('../lib/textwidth');

// The popup is 84 columns wide (herdr-plugin.toml); the editor keeps 2 spare.
const POPUP_COLS = 84;
const HELP_COLS = Math.max(60, POPUP_COLS - 2) - 1;
const VALUE_COLS = 18;

const nameOf = (field) => (field.table ? `${field.table}.${field.key}` : field.key);
const hasChinese = (text) => /[一-鿿]/.test(text);

test('every setting has a Chinese label and a Chinese description', () => {
  for (const field of FIELDS) {
    assert.ok(field.label && hasChinese(field.label), `${nameOf(field)} has no Chinese label`);
    assert.ok(field.help && hasChinese(field.help), `${nameOf(field)} has no Chinese description`);
  }
});

test('every description fits the help rows without being cut', () => {
  for (const field of FIELDS) {
    const lines = helpLines(field.help, HELP_COLS);
    assert.ok(lines.length <= HELP_ROWS, `${nameOf(field)} needs ${lines.length} rows`);
    assert.ok(!lines.at(-1).endsWith('…'), `${nameOf(field)} is cut off: ${lines.at(-1)}`);
    for (const line of lines) assert.ok(displayWidth(line) <= HELP_COLS, `${nameOf(field)}: "${line}" is too wide`);
  }
});

test('a setting row with its label fits the popup', () => {
  const keyWidth = Math.max(...FIELDS.map((field) => displayWidth(nameOf(field)))) + 2;
  for (const field of FIELDS) {
    // marker, cursor and spaces, the name column, the value column, the label.
    const width = 5 + keyWidth + VALUE_COLS + 1 + displayWidth(field.label);
    assert.ok(width <= POPUP_COLS - 2, `${nameOf(field)} row is ${width} columns wide`);
  }
});

test('title_width defaults to 32 and the old "follow the sidebar" value is gone', () => {
  const field = FIELDS.find((f) => f.key === 'title_width');
  assert.equal(field.fallback, 32);
  assert.ok(field.min >= 10, 'zero no longer means "read the sidebar"');
});
