# Notice

herdr-agentview is built on [herdr-radar](https://github.com/hhdebb/herdr-radar) v1.4.0 (MIT,
`d75fa3f`), itself forked from [qintmb/herdr-icon-agent-ui](https://github.com/qintmb/herdr-icon-agent-ui)
(MIT). The source tree (`bin/`, `lib/`, `test/`, `tools/`, `shell/`), the icon font in `dist/`, the
vendor marks in `assets/` and the upstream documentation in `docs/` come from there, renamed and
extended. Copyright of that code stays with its authors, see [LICENSE](LICENSE).

What differs from radar 1.4.0:

- The Spaces working-colour roster is limited so the generated row stays within Herdr's 16-token row
  limit (`lib/palette.js`, `test/sidebar-rows.test.js`).
- The Agents row carries Herdr's own `machine` token, hidden for `Local`.
- A title's trailing `| <project>` is removed (`lib/task.js`).

The icon font is JetBrains Mono, modified and renamed under the SIL OFL 1.1; vendor marks belong to
their owners. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `dist/OFL.txt`.
