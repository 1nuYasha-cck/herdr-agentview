'use strict';

// Branch and worktree detection from files alone: no git process, so the
// repositories here are built by hand the way git lays them out.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../lib/git');
const config = require('../lib/config');
const state = require('../lib/state');
const tabline = require('../lib/tabline');
const managed = require('../lib/managed-config');
const { displayWidth } = require('../lib/textwidth');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'av-git-'));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// A clone: `<root>/.git/HEAD`.
function clone(root, head = 'ref: refs/heads/main\n') {
  write(path.join(root, '.git', 'HEAD'), head);
  return root;
}

// A linked worktree of `main`, the way `git worktree add` writes it:
// a `.git` FILE in the worktree, and `<main>/.git/worktrees/<name>/` holding
// HEAD and a `commondir` that points back at `<main>/.git`.
function worktree(main, dir, name, head = 'ref: refs/heads/feat/x\n') {
  const admin = path.join(main, '.git', 'worktrees', name);
  write(path.join(admin, 'HEAD'), head);
  write(path.join(admin, 'commondir'), '../..\n');
  write(path.join(dir, '.git'), `gitdir: ${admin}\n`);
  return dir;
}

function withConfig(changes, fn) {
  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, config[key]]));
  Object.assign(config, changes);
  try {
    return fn();
  } finally {
    Object.assign(config, before);
  }
}

test('a plain clone reports its branch and is not a worktree', () => {
  const repo = clone(path.join(temp(), 'skills'));
  assert.deepEqual(git.describe(repo), { branch: 'main', linked: false, repo: null });
});

test('a subdirectory of a clone resolves to the clone', () => {
  const repo = clone(path.join(temp(), 'skills'));
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  assert.equal(git.describe(path.join(repo, 'src', 'deep')).branch, 'main');
});

test('a linked worktree is recognised and names the repository it was cut from', () => {
  const root = temp();
  const main = clone(path.join(root, 'skills'));
  const wt = worktree(main, path.join(root, 'skills-worktrees', 'lark-testcase-search'), 'lark-testcase-search');
  assert.deepEqual(git.describe(wt), { branch: 'feat/x', linked: true, repo: 'skills' });
});

test('a detached HEAD shows the short sha', () => {
  const repo = clone(path.join(temp(), 'r'), '0123456789abcdef0123456789abcdef01234567\n');
  assert.equal(git.describe(repo).branch, '0123456');
});

test('outside a repository, or with no readable HEAD, there is nothing to report', () => {
  assert.equal(git.describe(temp()), null);
  assert.equal(git.describe(''), null);
  const broken = path.join(temp(), 'r');
  write(path.join(broken, '.git', 'config'), '');
  assert.equal(git.describe(broken), null);
});

test('describeCached remembers for a moment and then looks again', () => {
  const repo = clone(path.join(temp(), 'r'));
  assert.equal(git.describeCached(repo, 1000).branch, 'main');
  write(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
  assert.equal(git.describeCached(repo, 1500).branch, 'main', 'a checkout is not seen within the cache window');
  assert.equal(git.describeCached(repo, 3500).branch, 'dev');
});

test('the Git row: a kind and one text per checkout, and the strategy decides when it shows', () => {
  const root = temp();
  const main = clone(path.join(root, 'skills'));
  const wt = worktree(main, path.join(root, 'wt'), 'wt');
  const dev = clone(path.join(root, 'dev'), 'ref: refs/heads/dev\n');
  const marks = { gitBranchMark: 'B', gitWorktreeMark: 'W' };

  withConfig({ ...marks, gitRow: 'always' }, () => {
    assert.deepEqual(state.gitRowText(main, 0), { kind: 'branch', text: 'B main' });
    assert.deepEqual(state.gitRowText(wt, 0), { kind: 'worktree', text: 'W feat/x' });
    assert.equal(state.gitRowText(path.join(root, 'nowhere'), 0), null);
  });
  withConfig({ ...marks, gitRow: 'auto' }, () => {
    assert.equal(state.gitRowText(main, 10000), null, 'the main branch of a plain clone adds nothing');
    assert.equal(state.gitRowText(dev, 10000).text, 'B dev');
    assert.equal(state.gitRowText(wt, 10000).kind, 'worktree');
  });
  withConfig({ ...marks, gitRow: 'off' }, () => assert.equal(state.gitRowText(main, 20000), null));
  withConfig({ gitRow: 'always', gitBranchMark: '' }, () => assert.equal(state.gitRowText(main, 30000).text, 'main'));
});

test('the Git row sets the token of its own kind and clears the rest', () => {
  const line = { mark: '', split: '', logo: '', titlePrefix: '' };
  const live = state.stateTokens('working', line, 'x', { kind: 'branch', text: 'B main' });
  assert.equal(live.git_branch, 'B main');
  assert.equal(live.git_worktree, null);
  assert.equal(live.git_stale, null);
  const worktreeRow = state.stateTokens('idle', line, 'x', { kind: 'worktree', text: 'W feat/x' });
  assert.equal(worktreeRow.git_worktree, 'W feat/x');
  assert.equal(worktreeRow.git_branch, null);
});

test('a parked session shows one neutral cell, and no text clears the row', () => {
  const line = { mark: '', split: '', logo: '', titlePrefix: '' };
  const parked = state.stateTokens('idle_stale', line, 'x', { kind: 'worktree', text: 'W feat/x' });
  assert.equal(parked.git_stale, 'W feat/x');
  assert.equal(parked.git_worktree, null);
  const none = state.stateTokens('idle', line, 'x');
  for (const name of state.GIT_TOKENS) assert.equal(none[name], null, name);
});

test('names from the two-cell version are cleared, not left on the pane', () => {
  const line = { mark: '', split: '', logo: '', titlePrefix: '' };
  const tokens = state.stateTokens('idle', line, 'x', { kind: 'branch', text: 'main' });
  for (const old of ['git', 'git_branch_icon', 'git_branch_text', 'git_worktree_icon', 'git_stale_text']) {
    assert.equal(tokens[old], null, old);
  }
});

test('the entry layout ends with a Git row of one coloured cell per kind', () => {
  const palette = require('../lib/palette');
  const entry = withConfig({ layout: 'entry' }, () => managed.sidebarBlock('dark'));
  const colours = palette.stateFor('dark');
  const cellFor = (name) => new RegExp(`token = "\\$${name}", fg = "(#[0-9a-f]{6})"`).exec(entry)?.[1];
  assert.equal(cellFor('git_branch'), colours.gitBranch);
  assert.equal(cellFor('git_worktree'), colours.gitWorktree);
  assert.notEqual(colours.gitBranch, colours.gitWorktree, 'the two kinds read apart');
  assert.doesNotMatch(entry, /git_branch_icon|git_branch_text/, 'no separate icon cell, so no separator');
  const grouped = withConfig({ layout: 'grouped' }, () => managed.sidebarBlock('dark'));
  assert.doesNotMatch(grouped, /\$git_branch/);
});

test('the tab bar line carries the branch and, in a worktree, the repository', () => {
  const root = temp();
  const main = clone(path.join(root, 'skills'));
  const wt = worktree(main, path.join(root, 'wt-dir'), 'wt');
  withConfig({ gitBranchMark: 'B', gitWorktreeMark: 'W' }, () => {
    const options = tabline.candidates(wt);
    assert.match(options[0], /wt-dir.* · B feat\/x · W skills$/, options[0]);
    // Narrower options drop the repository first, then shorten the path.
    assert.ok(options.some((line) => line.endsWith(' · B feat/x') && !line.includes('W skills')));
    assert.equal(options.at(-1), 'B feat/x', 'the branch is the last thing left');
    const plain = tabline.candidates(main);
    assert.ok(plain.every((line) => !line.includes('W ')), 'a plain clone has no worktree part');
  });
});

test('compose picks the longest candidate that fits, measured in columns', () => {
  const root = temp();
  const main = clone(path.join(root, 'skills'));
  const wt = worktree(main, path.join(root, 'wt-dir'), 'wt');
  withConfig({ gitBranchMark: 'B', gitWorktreeMark: 'W' }, () => {
    const wide = tabline.compose({ cwd: wt, row: 300, tabs: 1 });
    assert.ok(wide.endsWith('W skills'), wide);
    const narrow = tabline.compose({ cwd: wt, row: 60, tabs: 2 });
    assert.ok(displayWidth(narrow) <= Math.max(12, 60 - (24 + 5 * 2)), `${narrow} is ${displayWidth(narrow)} wide`);
    assert.ok(!narrow.includes('W skills'));
  });
});

test('the tab bar block polls every two seconds off Windows, and the timeout stays below it', () => {
  const block = managed.block();
  const [, interval, timeout] = /interval_seconds = (\d+), timeout_seconds = (\d+)/.exec(block);
  if (process.platform !== 'win32') assert.equal(Number(interval), 2);
  assert.ok(Number(interval) > Number(timeout));
});
