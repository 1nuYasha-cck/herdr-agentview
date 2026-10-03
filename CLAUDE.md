# herdr-agentview

A Herdr plugin built on herdr-radar: a Node daemon that publishes sidebar tokens (state, titles, project,
Git branch, sort keys) for each agent. The sidebar block in Herdr's `config.toml` renders them.

- Node 18+, CommonJS, no runtime dependencies. Tests: `npm test`. Consistency checks: `node tools/check.js`
  (identity, vendor roster, colour contrast, docs) must pass too.
- Herdr limits a sidebar row to 16 tokens and 16 rules per token, and rejects the whole config on a violation.
  Keep tokens few; style by token name or value rules instead of one token per state. `test/sidebar-rows.test.js`
  holds every generated row under the limit.
- A failed `agent.list` is "no data", never "no agents": do not clear tokens on it.
- The plugin writes three marked blocks into Herdr's `config.toml` (`lib/managed-config.js`) and nothing
  outside them. A table the user wrote themselves keeps its block out.
- Settings live in the plugin's own `config.toml`; `bin/settings.js` is the popup and its schema (`FIELDS`)
  carries the Chinese labels and descriptions, which a test keeps within the popup's width.
- Herdr cannot do two things this plugin would like: make a group header its own selectable entry, and report the
  sidebar's width. Do not try to work around them; see the limitations in README.md.
- `docs/radar-*` are the upstream radar docs, for reference only.
