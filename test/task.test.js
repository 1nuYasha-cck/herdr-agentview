'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveTask } = require('../lib/task');

const agent = (title, cwd = '/Users/me/work/lark-testcase-search') => ({
  terminal_title_stripped: title,
  cwd,
  foreground_cwd: cwd,
});

test('Codex "task | project" loses the project half', () => {
  assert.equal(deriveTask(agent('初始化当前 Skill 项目 | lark-testcase-search')), '初始化当前 Skill 项目');
});

test('the project half is matched against the workspace label too', () => {
  const title = 'Fix flaky login test | web-app';
  assert.equal(deriveTask(agent(title, '/tmp/x'), { workspaceLabel: 'Web-App' }), 'Fix flaky login test');
});

test('only trailing project segments are dropped', () => {
  assert.equal(deriveTask(agent('a | b | lark-testcase-search')), 'a | b');
  assert.equal(deriveTask(agent('fix a | b')), 'fix a | b');
});

test('a leading status glyph or spinner is removed', () => {
  assert.equal(deriveTask(agent('✳ Herdr侧边栏插件')), 'Herdr侧边栏插件');
  assert.equal(deriveTask(agent('⠋ raw title')), 'raw title');
  assert.equal(deriveTask(agent('◑ working on it')), 'working on it');
});

test('a title that says nothing yields null', () => {
  assert.equal(deriveTask(agent('lark-testcase-search')), null);
  assert.equal(deriveTask(agent('Claude Code')), null);
  assert.equal(deriveTask(agent('✳ Claude Code')), null);
  assert.equal(deriveTask(agent('   ')), null);
  assert.equal(deriveTask({}), null);
});

test('falls back to the unstripped title', () => {
  assert.equal(deriveTask({ terminal_title: '✳ Plan the migration', cwd: '/a/b' }), 'Plan the migration');
});

test('a trailing slash on the cwd does not hide the project name', () => {
  assert.equal(deriveTask(agent('do it | proj', '/a/proj/')), 'do it');
});

const { stripProjectSuffix } = require('../lib/task');

test('stripProjectSuffix removes trailing project segments only', () => {
  const dirs = ['/Users/me/work/lark-testcase-search'];
  assert.equal(stripProjectSuffix('初始化当前 Skill 项目 | lark-testcase-search', { dirs }), '初始化当前 Skill 项目');
  assert.equal(stripProjectSuffix('lark-testcase-search | notes', { dirs }), 'lark-testcase-search | notes');
  assert.equal(stripProjectSuffix('lark-testcase-search', { dirs }), '');
  assert.equal(stripProjectSuffix('a | Web', { labels: ['web'] }), 'a');
  assert.equal(stripProjectSuffix(undefined), '');
});
