'use strict';

// The branch a directory is on, read straight from `.git/HEAD`.
//
// Herdr's own `branch` token follows the pane's launch directory, and the agent
// harnesses that print a branch read it once and cache it — so both go stale the
// moment an agent runs `git checkout` mid-session. Reading HEAD is always
// current, and it is only a file read: this runs on the tab-bar's two-second
// timer, where spawning `git` would be far too expensive (quirks §7).
//
// The cost of that choice: no dirty marker. Knowing whether the tree is clean
// means actually asking git, so the branch here is the branch and nothing more.

const fs = require('node:fs');
const path = require('node:path');

// `.git` is a directory in a normal clone and a file in a worktree or submodule,
// where it holds `gitdir: <path>` pointing at the real one.
function gitDir(start) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.git');
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) return candidate;
      if (stat.isFile()) {
        const pointer = fs
          .readFileSync(candidate, 'utf8')
          .match(/^gitdir:\s*(.+)$/m)?.[1]
          ?.trim();
        if (pointer) return path.resolve(dir, pointer);
      }
    } catch {
      // Not here; keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The branch HEAD names, or a short sha when it is detached.
function readBranch(dir) {
  let head;
  try {
    head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1];
  if (ref) return ref;
  // Detached HEAD holds a raw sha. Seven characters is what git itself shows.
  return /^[0-9a-f]{7,40}$/i.test(head) ? head.slice(0, 7) : null;
}

// A linked worktree's git dir (`<repo>/.git/worktrees/<name>`) has a `commondir`
// file pointing back at the repository's own git dir. That file is the whole
// difference between a worktree and a clone, and it is what tells the main
// repository's name: `.git`'s parent, or the directory itself for a bare repo.
function mainRepository(dir) {
  let pointer;
  try {
    pointer = fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim();
  } catch {
    return null;
  }
  if (!pointer) return null;
  const common = path.resolve(dir, pointer);
  return path.basename(common) === '.git' ? path.basename(path.dirname(common)) : path.basename(common);
}

// Everything the sidebar and the tab bar show about a directory's repository,
// read from files alone: `{ branch, linked, repo }`, or null outside a repo.
// No `git` process — this runs on a timer — so there is no dirty marker.
function describe(cwd) {
  if (!cwd) return null;
  const dir = gitDir(cwd);
  if (!dir) return null;
  const branchName = readBranch(dir);
  if (!branchName) return null;
  const repo = mainRepository(dir);
  return { branch: branchName, linked: repo !== null, repo };
}

function branch(cwd) {
  return describe(cwd)?.branch ?? null;
}

// `describe` for the frame, which asks once per agent per frame while a
// spinner turns: remembered for a moment, long enough that a frame costs no
// disk reads and short enough that a checkout shows up on the next heartbeat.
const CACHE_MS = 2000;
const remembered = new Map();

function describeCached(cwd, now = Date.now()) {
  if (!cwd) return null;
  const hit = remembered.get(cwd);
  if (hit && now - hit.at < CACHE_MS) return hit.info;
  const info = describe(cwd);
  remembered.set(cwd, { at: now, info });
  if (remembered.size > 256) remembered.delete(remembered.keys().next().value);
  return info;
}

module.exports = { branch, describe, describeCached };
