# herdr-agentview

一个 [Herdr](https://herdr.dev) 插件，让侧边栏的 Agents 列表**一眼看清每个 agent 在做什么**：谁在干活、谁在等你回答、谁已经搁置了两个小时，以及每个 agent 的任务标题、所在项目、Git 分支和 worktree。

本项目基于 [herdr-radar](https://github.com/hhdebb/herdr-radar) v1.4.0（MIT）开发：保留了它的全部功能，并在此基础上做了面向日常使用的改进，见下文「相比 Radar 的变化」。

> 状态：**0.2.0，早期版本**。在 macOS 上日常使用，Linux 未实测。

## 功能

### 继承自 Radar

- **状态不会一闪而过**：完成后的 ✓ 保留到你看过为止，等待回答的 ? 保留到 agent 重新开始工作；空闲分三档，搁置越久越暗。
- **厂商 logo**：27 个厂商有自己的标志，用图标字体显示，各用自己的官方配色；工作中的 agent 前面有转动的盲文圆圈，等待回答时问号闪烁。
- **按活跃度排序**：最忙的项目在最前面。
- **tab 栏路径**、**跟随系统的浅色/深色主题**、**一个设置弹窗**。

### 相比 Radar 的变化

1. **每个 agent 自成一项（`entry` 布局）**：Radar 把工作区标题放在组内第一个 agent 的条目里，选中那个 agent 时标题行会一起被高亮；末尾的空行也一样。现在每个 agent 是一个独立条目：任务标题行，加项目名行，再加 Git 分支行，选中时只框住它自己。条目之间用 Herdr 原生的 `row_gap` 空一行（`agent_row_gap`，默认 1），这个空行画在条目外面，同样不会被框住。想要 Radar 原来的样子，把 `layout` 设成 `grouped`。
2. **干净的任务标题**：去掉标题开头的状态符号，以及 Codex 写在标题末尾的 `| 项目名`。
3. **长标题自动换行**：Herdr 本身只会用省略号截断。插件按显示宽度（中文占 2 列）把标题切到最多 3 行，装不下的才用 `…`。
4. **Git 分支行**：每个 agent 显示它所在目录的分支，worktree 用另一种图标和颜色（普通分支蓝，worktree 紫）。完全通过读取 `.git` 文件得到，不启动 `git`，也不依赖 Herdr 对 worktree 的识别。
5. **上半部分的工作区列表**：每个工作区下面列出它的所有 agent（默认最多 4 个，超出的合并成 `+N`），状态标记和下面一样会转动。
6. **右上角路径栏**：显示 `项目路径 · 分支 · 所属主仓库`（worktree 时），带图标；Herdr 的刷新间隔从 6 秒缩到 2 秒，并且在焦点变化时立即刷新。
7. **SSH 远程机器**：远程 agent 的条目最上面多一行机器名（本机隐藏，那一行自动折叠）。
8. **修复 Radar 1.4.0 在 Herdr 0.9.3 上无法写入侧边栏配置的问题**：它生成的工作区列表行有 18 个 token，超过 Herdr 的 16 个上限，整份配置会被拒绝。
9. **设置弹窗全部中文**：每个设置项都有中文名称和说明。

## 效果示意

下半部分 Agents（`entry` 布局，没有内容的行会自动折叠，条目之间空一行）：

```
⣾ ✳ 修登录页的并发问题          ← 状态 + 厂商图标 + 任务标题（长了会换行）
    web-app                      ← 项目名
    feat/login-race              ← Git 分支（worktree 用另一种图标和颜色）

MacBook                          ← 远程 agent 才有：机器名在条目最上面
   ✳ 补充单元测试                ← Herdr 会把它之后的行缩进 2 列
   web-app
   main
```

远程 agent 的标题行比本机的少 2 列宽度，建议在远程那台机器的插件设置里把 `title_margin` 设成 2。

上半部分工作区列表：

```
▾ Local
  ○ web-app
    ✳ 修登录页的并发问题
    ◎ 补充单元测试
▾ MacBook                        ← 远程机器
  ○ WorkSpace
    ✳ Claude Code
```

## 安装

需要 **Herdr 0.9.0 及以上**、**Node 18 及以上**。图标需要支持 Nerd Font 符号的终端，Ghostty 自带。

```sh
herdr plugin install 1nuYasha-cck/herdr-agentview
herdr plugin action invoke chenchangkai.agentview.state-start
```

安装时插件会自己完成这几件事：

- 往 Herdr 的 `config.toml` 里写**三个带标记注释的配置块**（标签栏、主题、侧边栏），块以外的内容不会动。
- 把图标字体装到你的用户字体目录（不需要管理员权限）。
- 如果存在 Ghostty 或 kitty 的配置，把字符映射也写进去。**写完后需要重载终端配置或重开窗口**（Ghostty 是 `cmd+shift+,`）。

> **不要用 `herdr server stop` 来让它生效。** 那会结束所有 pane 里的进程，包括正在运行的 agent。`state-start` 动作就够了。

如果你的 `config.toml` 里已经有自己写的 `[ui.sidebar.*]` 或 `[theme.custom]`，插件会跳过对应的块（以免冲突），并提示你。删掉你自己的那段，再运行一次 `chenchangkai.agentview.configure` 即可。

### 绑定设置弹窗的快捷键（可选）

```toml
[[keys.command]]
key = "prefix+comma"          # 也可以用 "ctrl+alt+comma"
type = "plugin_action"
command = "chenchangkai.agentview.settings"
```

## SSH 远程机器

Herdr 的每台机器各有自己的 server，插件的守护进程只给**自己那台机器**上的 pane 发布 token。所以：

1. **每台机器上都要装同一个版本的插件**（本机和远程都执行上面的安装）。
2. 本机客户端用本机配置里的行布局来渲染远程 agent，两边的 token 名必须一致，所以版本要相同。
3. 如果你也会在远程那台机器上直接使用 Herdr，或者从它去看别的机器，那台机器上同样需要有侧边栏配置块和图标字体，安装时已经自动完成。
4. 右上角那一栏的命令是在对应机器的 server 上执行的，所以查看远程 agent 时显示的是那台机器的路径和分支。

## 设置

按 `prefix+,`（需要先绑定，见上）打开设置弹窗：`↑↓` 选择、`←→` 修改、`↵` 编辑、`r` 恢复默认、`s` 保存并生效、`q` 关闭。保存后会重启守护进程。配置文件在 `$(herdr plugin config-dir chenchangkai.agentview)/config.toml`，也可以手改，然后执行 `state-stop`、`state-start`。

| 设置项 | 名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `agents_panel` | 面板来源 | plugin | Agents 面板用谁的行：plugin = 本插件的样式和排序，herdr = Herdr 原生样式。很少改动，所以放在设置里而不是快捷键。 |
| `order` | 排序方式 | active | Agents 面板的顺序：active = 按项目分组、最忙的在前、搁置的在后；recent = 不分组、按最近活动平铺；off = Herdr 原顺序。仅 agents_panel 为 plugin 时有效。 |
| `reorder_workspaces` | 工作区重排 | 关 | 让 Herdr 的工作区编号跟随活跃度顺序，这样 prefix+shift+1..9 和面板顺序一致。注意：这会改变全局的工作区顺序。 |
| `variant` | 图标样式 | auto | 厂商 logo 和状态标记的显示方式：font = 图标字体，text = 普通 Unicode 字符，none = 不显示，auto = 自动（只有 Linux 能探测字体，其他系统按 text 处理）。 |
| `done_hold` | 完成标记保留 | until_seen | “完成 ✓”标记保留多久：until_seen = 直到你聚焦到那个窗格；也可以选一个秒数，到时自动消失。 |
| `blocked_hold` | 等待标记保留 | 开 | 开启：“等待回答 ?”一直保留到 agent 重新开始工作；关闭：只在 agent 实际处于等待时显示。 |
| `idle_grace_seconds` | 空闲防抖 | 2.5 | 空闲状态要持续这么多秒，才算上一轮对话结束，用来过滤状态识别时的瞬间抖动。 |
| `activity_fresh_minutes` | “刚活跃”时长 | 15 | 一轮结束后的这段分钟数内，空闲的 agent 仍显示为“刚活跃”（浅绿色）。 |
| `activity_stale_minutes` | “已搁置”时长 | 120 | 超过这么多分钟没有新一轮，空闲的 agent 会变灰变暗，并排到本组最后。 |
| `group_indent` | 分组缩进 | 2 | 仅 grouped 布局：成员在工作区标题下缩进几列；0 = 不缩进。 |
| `group_gap` | 分组空行 | 开 | 仅 grouped 布局：不同工作区之间是否空一行。 |
| `layout` | 条目布局 | entry | entry = 每个 agent 自成一项（标题行 + 项目行），选中时只框住它自己；grouped = Radar 原样，工作区标题藏在组内第一项里。 |
| `agent_row_gap` | 条目间距 | 1 | 下半部分每两个 agent 条目之间空几行，0 = 紧贴。空行画在条目外面，不会被选中框框住。 |
| `title_wrap` | 标题最多行数 | 3 | 长标题最多换成几行，装不下的结尾用 … 表示；1 = 不换行（和 Herdr 原样一样，用省略号截断）。 |
| `title_width` | 换行宽度 | 32 | 标题按多少列换行，默认 32，等于你现在的 sidebar_max_width。调整了侧边栏宽度后，把这里改成相应的列数。 |
| `title_margin` | 换行微调 | 0 | 微调换行位置：正数更早换行，负数更晚。标题右侧还被省略号截断就调大。远程机器的标题多缩进 2 列，那台机器上建议设成 2。 |
| `git_row` | Git 分支行 | always | 每个 agent 条目的第三行，显示它所在目录的 Git 分支：always = 只要在 Git 仓库里就显示；auto = 只在 worktree 或非 main/master 分支时显示；off = 不显示。 |
| `git_branch_mark` | 分支图标 | U+E0A0 | 分支名前面的图标，需要 Nerd Font（Ghostty 自带）。填码点如 U+E0A0，留空 = 不显示图标。右上角也用它。 |
| `git_worktree_mark` | worktree 图标 | U+F418 | 目录是 Git worktree 时用的图标：侧边栏第三行用它代替分支图标，右上角用它标出所属的主仓库。填码点如 U+F418，留空 = 不显示。 |
| `space_agents` | 工作区列出数 | 4 | 上方工作区列表里每个工作区最多列出几个 agent（每个一行），多出来的合并成 +N；0 = 只在一行里显示厂商图标。 |
| `split_corner` | 分屏连接线 | 关 | 同一标签页里分屏的其他窗格，是否用 ├─ 连接线挂在第一个窗格下面；关闭则当作普通行。 |
| `row_label` | 行显示内容 | title | agent 那一行显示什么：title = 会话标题，tab = 所在标签页的名字，both = 两者都显示。 |
| `trim_group_prefix` | 去掉重复项目名 | 开 | 标题开头如果重复了工作区名，就把它去掉（项目名已经单独显示了）。 |
| `worktree_mark` | worktree 标记 | U+F418 | 仅 grouped 布局：worktree 标题前的小图标，需要 Nerd Font。填码点如 U+F418，留空 = 不显示。 |
| `follow_appearance` | 跟随明暗 | 开 | Herdr 主题是否跟随系统的浅色/深色模式自动切换（每分钟检查一次）。 |
| `colors.active_row_bg_light` | 选中行底色（浅色） | #b9cdf2 | 浅色主题下选中行的底色，写进 [theme.custom]；留空 = 沿用主题自带的颜色。 |
| `colors.active_row_bg_dark` | 选中行底色（深色） | #414868 | 深色主题下选中行的底色；留空 = 沿用主题自带的颜色。 |

## 已知限制（Herdr 本身的限制）

- **没法在下半部分让「工作区标题」成为独立可选的条目。** Herdr 的 Agents 面板里每个 agent 是一个条目，点击区域和选中高亮盖住它的所有行，没有"标题条目"这种类型。所以组标题只能藏在某个 agent 条目里，选中它就会带上标题。`entry` 布局就是为绕开这一点而设计的。
- **没法从上半部分的工作区列表里直接选中某一个 agent。** 工作区条目的点击目标是整个工作区，里面的行只是显示内容。选具体 agent 请用下半部分，或者 Herdr 的 `goto`。
- **读不到侧边栏的实际宽度。** 侧边栏由客户端绘制，API 不提供宽度，所以换行用 `title_width` 设置（默认 32，对应 `sidebar_max_width`）。
- **标签栏右侧不会随焦点自动刷新**，Herdr 只按固定间隔执行命令，所以最坏有约 2 秒的延迟。
- 没有"有未提交修改"的标记：判断它需要真正运行 `git`，开销太大。

## 常见问题

**图标显示成方块或问号**
终端还没有加载字体：打开新窗口；不行就完全退出终端再打开。macOS 还有字体缓存：`killall fontd fontworker` 后重开。

**图标显示成随机的汉字**
别的字体占用了同一段私有区码位（CJK 字体经常这样）。终端必须把这些码位映射到 `Herdr Agent Icons Max`，只加成备用字体是不够的。Ghostty 和 kitty 运行 `herdr plugin action invoke chenchangkai.agentview.install-font` 会自动写入映射；其他终端请手动映射 U+E1A0–U+E1BA 和 U+E1C0–U+E1C5 两段。没有码位映射功能的终端（Windows Terminal、iTerm）可以改用 `dist/JetBrainsMonoHerdr-Regular.ttf` 作为终端字体。

**侧边栏没变化**
守护进程没在运行：`herdr plugin action invoke chenchangkai.agentview.state-start`。还不行就看日志：`herdr plugin log list --plugin chenchangkai.agentview --limit 20`。常见原因：Herdr 能看到的 PATH 里没有 Node 18+，或者 `config.toml` 里没有 `[ui]` 表。

**改了设置没生效**
守护进程只在启动时读配置。设置弹窗里按 `s` 保存会自动重启；手改文件后要 `state-stop` 再 `state-start`。直接改 `config.toml` 里的三个配置块是不会保留的，下次 `configure` 会写回去。

**为什么看不到 worktree 或分支**
这一行默认显示（`git_row = always`）。只有目录在 Git 仓库里才有，不在仓库里的 agent 不会有这一行。

## 卸载

按下面的顺序，`unconfigure` 要在插件还装着的时候才能执行：

```sh
herdr plugin action invoke chenchangkai.agentview.unconfigure
herdr plugin action invoke chenchangkai.agentview.uninstall-font
herdr plugin uninstall chenchangkai.agentview
```

它会停掉守护进程、清除它写过的所有 token、移除三个配置块。保留下来的只有 `~/.local/state/herdr/plugins/chenchangkai.agentview` 里的配置备份，不需要的话手动删除。

## 工作原理

一个常驻的 Node 守护进程，由 Herdr 的事件流唤醒，从 `herdr agent list` 取一份快照，把状态、标题、分支、排序键这些信息写成侧边栏的 token；侧边栏的行配置引用这些 token。不联网。除了 Herdr 的配置和它自己的状态目录，它只读两类东西：agent 会话自己的记录（Claude、Codex 的会话文件，用来给启动前就存在的 pane 补上最后活动时间），以及各个工作目录里的 `.git/HEAD`。和所有 Herdr 插件一样，它以你的身份运行，Herdr 不做沙箱，介意的话安装前请读一下 `herdr-plugin.toml` 和 `bin/`。

## 开发

```sh
npm test               # node:test，没有第三方运行时依赖
node tools/check.js    # 一致性检查：名称、厂商清单、配色对比度、文档
```

目录：`bin/` 命令行入口，`lib/` 核心逻辑，`test/` 测试，`tools/` 检查脚本，`dist/` 图标字体，`assets/` 厂商标志，`docs/` Radar 的上游文档（英文，仍适用于继承的功能）。

## 致谢与许可

MIT，见 [LICENSE](LICENSE)。

- 基于 [hhdebb/herdr-radar](https://github.com/hhdebb/herdr-radar) v1.4.0（MIT），它又分叉自 [qintmb/herdr-icon-agent-ui](https://github.com/qintmb/herdr-icon-agent-ui)（MIT）。详见 [NOTICE.md](NOTICE.md)。
- 图标字体是 JetBrains Mono 的修改版，按 SIL OFL 1.1 改名发布（`dist/OFL.txt`）；厂商标志属于各自的所有者，来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
