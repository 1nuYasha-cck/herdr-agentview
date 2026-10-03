'use strict';

// What an agent is working on, read from the title it puts on its terminal.
//
// Agents decorate that title differently: Claude Code leads with a status
// glyph or spinner, Codex writes `<task> | <project>`. The sidebar already
// shows the project through its workspace, so repeating it only eats columns.
// This returns the part that says what the agent is doing, or null when the
// title says nothing (a bare project name, or the agent's own product name).

// Status glyphs, spinners and bullets an agent puts in front of its title:
// Braille patterns, dingbats, geometric shapes, middle dot, asterisk.
const LEADING_DECORATION = /^[\s⠀-⣿✀-➿■-◿•·*]+/u;

// Product names agents show before they have a real title.
const GENERIC_TITLES = new Set(['claude code', 'claude', 'codex', 'gemini', 'opencode', 'cursor', 'copilot']);

const SEPARATOR = ' | ';

function basename(dir) {
  if (typeof dir !== 'string') return '';
  const trimmed = dir.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

// Removes trailing ` | <project>` segments, where a project is the name of any
// directory in `dirs` or any label in `labels`. Returns '' when nothing else is
// left, so the caller can fall back to something that does say what it is.
function stripProjectSuffix(title, { dirs = [], labels = [] } = {}) {
  const projects = new Set(
    [...dirs.map(basename), ...labels]
      .filter((name) => typeof name === 'string')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  const parts = String(title ?? '')
    .split(SEPARATOR)
    .map((part) => part.trim());
  while (parts.length > 0 && projects.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  return parts.join(SEPARATOR).trim();
}

function deriveTask(agent, { workspaceLabel = '' } = {}) {
  const raw = agent.terminal_title_stripped ?? agent.terminal_title ?? '';
  const title = raw.replace(LEADING_DECORATION, '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const task = stripProjectSuffix(title, { dirs: [agent.cwd, agent.foreground_cwd], labels: [workspaceLabel] });
  if (!task || GENERIC_TITLES.has(task.toLowerCase())) return null;
  return task;
}

module.exports = { deriveTask, stripProjectSuffix };
