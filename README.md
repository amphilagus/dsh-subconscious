# @amphilagus/dsh-subconscious

DeepSeek Harness 的「双重意识」插件，配套 agent preset **双重意识**。标准编码 Agent 默认不加载本工具集，只有选中该 preset 的会话才会启用。

表意识不直接读文件原文。需要看内容时调用同步独占工具 `view`：插件内部拉起一个只读的潜意识子代理，用原生 `read` / `grep` / `glob` 按目的观察，再把有上限的摘要交回表意识。模型侧没有 `subagent` / `workflow` / `ralph`。

## 用法

在 **双重意识** 会话里像普通编码 agent 一样工作，但看文件走 `view`，不要 `read` / `grep`，也不要用 bash `cat` / `rg` 绕过。

`view` 三个参数都必填：

| 参数 | 含义 |
|---|---|
| `paths` | 要看的一个或多个文档 |
| `purpose` | 这一眼要解决什么（总览、找某机制的线索、核对某段行为） |
| `background` | 阅读前的心理状态：我在做什么、看完要去做什么 |

`view` 是独占的：这一次调用结束之前，表意识不能并行其它工具。返回的是按 `purpose` 提炼过的摘要，不是带行号的全文。`glob` 和 `ls` 仍可用来列文件名。

## 两件东西，分别安装

| 产物 | 是什么 | 装到哪 |
|---|---|---|
| **插件** `@amphilagus/dsh-subconscious` | host 平面 bundle：默认 `enabled: false`，不给任何会话注册 `view` | 目标 profile（例如 `web`）的 `dsh.profile.bundles` |
| **preset** `preset/` | agent 平面组合：人设 + 把本插件以 `enabled: true` 挂上 + 关掉整组 delegation | `$DSH_HOME/.agent-presets/double-conscious` |

只装插件、不装 preset：工具全部关闭，picker 里也没有「双重意识」。只装 preset、不装插件：preset 里的 `@amphilagus/dsh-subconscious` 行解析失败，会话起不来。

`./scripts/install-profile.sh web` 会两步一起做：链进 profile，并把 `preset/` 拷到 `$DSH_HOME/.agent-presets/double-conscious/`（未设 `DSH_HOME` 时，优先用仓库旁的 `../.dsh`，否则 `~/.dsh`）。

## 部署

下面默认 profile 名为 `web`，DSH home 为 `~/.dsh`（若设了 `DSH_HOME` 则换成那个目录）。web profile 关了 HMR，装完后要重启 `dsh --profile web` 才生效。

### 1. 安装插件并放置 preset

```sh
cd dsh-subconscious
pnpm install
pnpm run build
./scripts/install-profile.sh web
```

或分步：

```sh
dsh plugin --profile web add "link:/绝对路径/dsh-subconscious"
mkdir -p ~/.dsh/.agent-presets
cp -R preset ~/.dsh/.agent-presets/double-conscious
```

应得到：

```
~/.dsh/.agent-presets/double-conscious/preset.yml
~/.dsh/.agent-presets/double-conscious/agent.cordis.yml
```

host 上的那一行是空壳（`enabled: false`），标准 / 文献跟踪助理等 preset 仍然没有 `view`，也仍然能直接 `read`。

`preset.yml` 只是 picker 上的显示名「双重意识」。改人设或 `maxSummaryTokens`，编辑的是 **拷过去之后** 的 `agent.cordis.yml`，不是仓库里的源文件（除非你改完再重新拷）。

Web UI 的 agent-preset picker 应出现「双重意识」。已有会话不能中途换 preset，开一个**新会话**再选。

### 2. 重启并验收

```sh
dsh --profile web
```

1. 新建会话，选「双重意识」。
2. 表意识工具列表里应有 `view`、`glob`、`bash`，**没有** `read`、`grep`，也没有 `subagent` / `workflow` / `ralph`。
3. 让 agent `view` 几个文件并写清 `background` 与 `purpose`，应同步等到一段摘要，而不是带行号的全文。
4. 让 agent `read` 或 `bash cat` 某文件：`read` 应表现为不存在；`cat` / `rg` 应被拒并提示改用 `view`。
5. 另开一个标准模式会话：没有 `view`，`read` / `grep` 仍在。

## 分层怎么工作

preset **不能**从 YAML 里拿掉 `@deepseek-ai/dsh-tool-fs`。潜意识子代理通过 `composeFrom()` 继承本 preset 的完整工具表，删掉 `read` 它也读不成。

实际切开：

- preset 目录里仍注册原生 `read` / `grep` / `glob`（专供潜意识）。
- 会话根（表意识）上 `agent.ctx.tools.restrict({ deny: ['read', 'grep'] })`：模型看到的 tools 列表里没有这两项，调用报 unknown tool。
- `view` 内部 `ctx.subagents.start('spawn')` 打上 `label: subconscious`，`toolFilter.allow` 只有 `read` / `grep` / `glob`。
- `tools.guard` 拦表意识用 bash/`pwsh` 读原文或文内搜索（`cat`、`head`、`rg`、`git show` 等）。`ls` / `find` / `wc` 仍可。这不是沙箱，只拦明显绕法。

host 上的 spawn **服务**仍在；关掉的是模型侧 delegation 工具。`view` 不依赖 `subagent` 这个工具名。

## 常用配置

插件配置写在 **preset 那次重新挂载** 上（host 空壳的 `enabled: false` 行改 token 上限不会传到本 agent）。编辑：

`$DSH_HOME/.agent-presets/double-conscious/agent.cordis.yml`

```yaml
- id: subconscious
  name: '@amphilagus/dsh-subconscious'
  config:
    enabled: true
    maxSummaryTokens: 1000
    # viewToolName: view
```

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | host 上 `false`；本 preset 必须 `true` | 主开关 |
| `viewToolName` | `view` | 表意识看到的工具名 |
| `maxSummaryTokens` | `1000` | 潜意识返回摘要的上限（写入 prompt，返回后再按约 4 字符/token 硬截） |

改完 preset 文件后新开的会话才会用新组合；已在跑的会话保持启动时那一版。

## 开发

```sh
pnpm install
bash scripts/link-dsh.sh   # 把 DSH checkout 里的 @deepseek-ai/* 链到本包
pnpm run typecheck
pnpm run test
pnpm run build
```

测试不拉真子代理，`ctx.subagents.start` 用 mock。

## License

[MIT](LICENSE)
