'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { displayWidth, wrapByWidth } = require('../lib/textwidth');

test('displayWidth counts Han characters as two columns and marks as none', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('初始化'), 6);
  assert.equal(displayWidth('a初b'), 4);
  assert.equal(displayWidth('é'), 1);
  assert.equal(displayWidth(''), 0);
});

test('a title that fits is left alone', () => {
  assert.deepEqual(wrapByWidth('fix the login page', { first: 22, maxLines: 3 }), ['fix the login page']);
});

test('a long title wraps at spaces and keeps words whole', () => {
  const lines = wrapByWidth('refactor the authentication middleware for sessions', { first: 22, rest: 24, maxLines: 3 });
  assert.deepEqual(lines, ['refactor the', 'authentication', 'middleware for sessions']);
  for (const line of lines) assert.ok(displayWidth(line) <= 24, line);
});

test('Han text breaks where the line fills, counting two columns each', () => {
  const lines = wrapByWidth('初始化当前项目并检查所有测试用例的覆盖情况', { first: 10, rest: 10, maxLines: 5 });
  assert.deepEqual(lines, ['初始化当前', '项目并检查', '所有测试用', '例的覆盖情', '况']);
  for (const line of lines) assert.ok(displayWidth(line) <= 10, `${line} is ${displayWidth(line)} wide`);
  assert.equal(lines.join(''), '初始化当前项目并检查所有测试用例的覆盖情况');
});

test('what does not fit on the last line is cut with an ellipsis', () => {
  const lines = wrapByWidth('one two three four five six seven eight nine ten', { first: 10, rest: 10, maxLines: 2 });
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  assert.ok(displayWidth(lines[1]) <= 10);
});

test('mixed Latin and Han text stays within the width', () => {
  const lines = wrapByWidth('初始化当前 Skill 项目 lark-testcase-maintain', { first: 14, rest: 16, maxLines: 3 });
  for (const [index, line] of lines.entries()) assert.ok(displayWidth(line) <= (index === 0 ? 14 : 16), line);
});

test('one-line mode truncates instead of wrapping', () => {
  const lines = wrapByWidth('a very long title that will not fit on one line', { first: 12, maxLines: 1 });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('…'));
});

test('empty and degenerate input does not loop', () => {
  assert.deepEqual(wrapByWidth('', { first: 10 }), []);
  assert.ok(wrapByWidth('abcdefghij', { first: 1, rest: 1, maxLines: 3 }).length <= 3);
});
