# dsh-zvec-grep

Automatic semantic workspace search for DeepSeek Harness, powered by Alibaba [zvec](https://github.com/alibaba/zvec) and the public [zvec-grep](https://github.com/zvec-ai/zvec-grep) engine API.

## Installation

This fork is distributed as a local tarball, not from npm. Build and pack it once, then install the tarball into your Harness profile:

```bash
# 1. build the plugin tarball
npm install
npm run build
npm pack                      # -> sugarforever-dsh-zvec-grep-<version>.tgz

# 2. install it into a profile (repeat for every profile you use)
dsh plugin --profile web add ./sugarforever-dsh-zvec-grep-<version>.tgz
```

Then start DeepSeek Harness as usual and restart it after every plugin upgrade - the plugin is loaded with the profile.

That is the complete setup. No need to run `zg install`, `zg index`, or start an MCP server.

The search engine `@zvec/zvec-grep` is declared as an **optional peer dependency**, so the plugin install never pulls the engine or its dependency chain - a plugin install stays a few megabytes, works behind any network policy, and an engine download can never fail the plugin installation. The engine is resolved lazily, only when a workspace is enabled for indexing (see [Enabling a workspace](#enabling-a-workspace)).

### Installing the engine

Install the engine once, before enabling indexing in any workspace:

```bash
npm install -g @zvec/zvec-grep
```

The default `engineModule` is the bare specifier `@zvec/zvec-grep`, and resolution also covers the global npm root, so an engine installed that way is picked up without further configuration. Until then, enabling a workspace returns `status: error` with the exact command above; a missing engine is re-probed at most once every 30 seconds, so installing it while Harness is running recovers on the next search without a restart.

If you prefer the engine inside the profile tree instead of the global npm root, install it explicitly into the profile (`npm install --prefix <profile dir> @zvec/zvec-grep`, or add it to the profile's `package.json`). Because it is an optional peer, no package manager will add it back on the plugin's behalf.

When the engine **is** installed into a pnpm-managed profile, pnpm 10 and newer refuse to run its install scripts (`@zvec/zvec`, `onnxruntime-node`, `sharp`, `@vscode/ripgrep`) and reports `ERR_PNPM_IGNORED_BUILDS`. The Harness plugin command treats any non-zero pnpm exit as a failed install and then skips wiring the plugin into `dsh.profile.bundles`, which leaves the plugin installed but never loaded. Approve those builds through pnpm's `allowBuilds` setting in `pnpm-workspace.yaml` so the install exits cleanly.

Do not run `zg --server` for a workspace while the plugin is active: both would own the same `.zvec-grep/` index.

## How it works

When Harness creates or resumes a session, the plugin reads the workspace from the immutable `session.header.cwd`, starts a file watcher, and builds the initial index in the background. Search never waits for indexing and never triggers an update. If the index is busy or unavailable, `zvec_search` returns a structured `indexing`, `refreshing`, or `error` status so the Agent or user can decide whether to retry later or use exact grep.

Added, changed, and deleted paths are debounced and submitted to zvec-grep's incremental index API in the background. An hourly full reconciliation repairs drift if the operating-system watcher missed an event.

The Harness workspace also gets a **Zvec index** status pill. It reports `Indexing`, `Refreshing`, `Ready`, `Error`, or `Off` without blocking search. Select the pill to see the active workspace, the pending change count, and the latest index progress (scanning, per-file counts, and embedding-model download); the pill is read-only - enablement and scope live in the settings page. The UI is installed with the plugin; there is no separate frontend setup.

The settings **Plugins** page has a **Zvec Search** card listing every workspace known to the session, each with an indexing switch and an excluded-directories editor (entries match the `excludePaths` rules below). Advanced scope fields (globs, file types, depth limits, ...) stay agent-managed through `zvec_manage`; card edits merge into the persisted scope, so they never erase agent-set fields. The list follows live sessions: right after a restart only the restored session's workspace is listed, and the others appear as you open them - each workspace's enablement persists in its own `.zvec-grep/config.json` regardless.

## Enabling a workspace

Indexing is **opt-in per workspace**. A workspace with no configuration and no previous index stays off: sessions start without an engine, a watcher, or an embedding-model download, and `zvec_search` returns a structured `disabled` status instead of building anything. The full per-workspace configuration reference lives in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

To turn a workspace on, either:

- open the settings page's **Zvec Search** section and flip the workspace's switch (the toggle writes the configuration and starts indexing immediately), or
- create `<workspace>/.zvec-grep/config.json` containing `{"enabled": true}` and start a new search.

If the switch reports an error, the toggle channel is unavailable in that Harness build; edit `config.json` by hand instead - it is the same file the switch writes, and the change takes effect on the next search or session start.

State persists as plain files under `.zvec-grep/`, evaluated in this order:

1. `config.json` with a boolean `enabled` field is authoritative - a workspace disabled here stays off across plugin and engine upgrades.
2. Without `config.json`, a workspace that already has an engine `manifest.json` predates the toggle and stays enabled, so upgrading never silently turns off existing setups.
3. Neither file exists: the workspace follows the `defaultEnabled` option (off by default).

Deleting the whole `.zvec-grep/` directory therefore returns a workspace to the default state, and re-enabling simply rebuilds the index.

The first workspace may download the default local embedding model. Indexes are stored under `<workspace>/.zvec-grep/` and are excluded from their own scans. Add `.zvec-grep/` to the repository ignore rules if the project does not already ignore local tool state.

## Tool for agents

`zvec_search` searches the calling session's workspace. A successful call returns `status: ready` plus bounded source excerpts with relative paths, line ranges, freshness, match routes, and scores. Non-ready calls return immediately without partial or silently stale results.

Use it when wording or location is unknown, or when the question requires architecture, relationships, control flow, design rationale, or synthesis across files. Use Harness' exact grep for known identifiers, literals, regular expressions, configuration keys, error messages, and exhaustive occurrence lists.

Optional time filters narrow results to files modified in a window: pass `modifiedAfter` and/or `modifiedBefore` as ISO 8601 dates or timestamps (e.g. `2026-09-15` or `2026-09-15T10:00:00Z`). Both bounds together must form a non-empty window.

Symbol-aware retrieval: pass `preferSymbol: true` to prefer indexed code symbols over surrounding prose, optionally narrowed with `symbolTypes` (one or more of `module`, `class`, `interface`, `function`, `value`, `alias`, e.g. `["function", "class"]`). Pass `trace: true` to attach per-hit retrieval diagnostics (recall routes, fusion, ranking) to each result when debugging retrieval quality. Indexed results may also carry `metadata`: code symbol facts (symbol type, name, signature, doc, modifiers) or markdown heading context (heading, level, scope).

`zvec_manage` governs the calling session's workspace index:

- `enable` / `disable` persist the toggle in `config.json` and start or stop indexing. A disabled workspace makes `zvec_search` report `status: disabled` instead of searching; do not retry, enable the workspace first.
- `status` reports enablement, index phase, and the current scope without side effects.
- `rebuild` queues a full re-embed; `drop` deletes the index storage (manifest and embedding stores) while keeping `config.json`, so enablement and scope survive.
- `scope` reads or sets the per-workspace scope (see below). Setting a scope queues a rescan.

All actions operate on the session's own workspace; the tool cannot touch other directories.

### Workspace scope

The scope controls which files the index covers, per workspace. It is persisted in `config.json` next to the `enabled` flag and supports the engine's filter set: `includePaths`, `excludePaths`, `globs`, `insensitiveGlobs`, `fileTypes`, `excludedFileTypes`, `ignoreFiles`, `maxDepth`, `maxFileSizeBytes`, `follow`, `hidden`, `noIgnore`, and `embeddingConcurrency`.

```jsonc
// <workspace>/.zvec-grep/config.json
{
  "enabled": true,
  "scope": { "excludePaths": ["src/vendor/**"], "maxDepth": 12 }
}
```

Merge rules: workspace `excludePaths` are unioned with the plugin-global `excludePaths`; every other scope field replaces the global default for that workspace. Every index pass sends the complete merged scope with a path-filter reset, so the engine's persisted manifest always mirrors the current scope - clearing a scope field really clears it, and edits take effect on the next index pass without restarting the Harness.

## Lifecycle

```text
DSH bundle installation
  -> mounts @sugarforever/dsh-zvec-grep
  -> the optional engine module is resolved lazily, on first workspace activation
  -> session/created supplies session.header.cwd
  -> file watcher and background initial index start automatically
  -> watcher events are coalesced into index({ changedPaths }) calls
  -> hourly index() reconciliation compensates for missed events
  -> zvec_search uses the calling Agent's session cwd
  -> context(autoUpdate: false) searches only when the index is ready
  -> plugin disposal closes every workspace engine
```

Sessions sharing a workspace reuse one in-process engine, watcher, and indexing coordinator. A failed background operation is reported as `status: error`; searches do not retry it. The one exception is a missing engine module, which is re-probed after the retry interval so a fresh `npm install -g @zvec/zvec-grep` is picked up without restarting Harness.

## Configuration

The bundled defaults work without configuration. For the complete per-workspace `config.json` reference (enablement, scope), see [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

```yaml
- id: zvec-grep
  name: '@sugarforever/dsh-zvec-grep'
  config:
    engineModule: '@zvec/zvec-grep'
    embedding: local/potion-code-16m-v2
    device: auto
    excludePaths: []
    defaultEnabled: false
    defaultLimit: 10
    maxLimit: 30
    watchDebounceMs: 750
    reconcileIntervalMs: 3600000
    statusPollIntervalMs: 2000
```

Node.js 22 or newer is required. `engineModule` accepts a package specifier, an absolute or relative filesystem path, or a `file:` URL; it is resolved lazily, in the order explicit location, bare specifier, then the global npm root. `device` accepts `auto`, `cpu`, `metal`, `vulkan`, or `cuda`. `reconcileIntervalMs: 0` disables periodic reconciliation; the default is one hour. `statusPollIntervalMs` controls the lightweight workspace-status UI refresh interval and defaults to two seconds. `defaultEnabled` only applies to workspaces with no `config.json` and no existing index; see [Enabling a workspace](#enabling-a-workspace).

### excludePaths

`excludePaths` lists workspace-relative paths or glob patterns the engine must never index or search. Entries are matched against paths relative to the workspace root: a bare directory name matches only a directory at the workspace root (`secret` excludes `secret/**`), so nested directories need their own prefix - e.g. `src/vendor/**` or `docs/generated/**`. The filter is applied to the initial index, every incremental update and reconciliation, and searches (including the rg fallback, which reads it from the call options rather than the persisted manifest).

```yaml
config:
  excludePaths:
    - vendor
    - docs/generated/**
```

Use it for directories that stay in version control but carry no semantic search value, or that are maintained by other tooling. It is additive on top of the engine's built-in rules (`.gitignore`, hidden directories, and common build/Vendored defaults such as `node_modules` and `dist`); configured paths are persisted into the workspace manifest, so changing the list takes effect on the next index pass of each workspace. For per-workspace control from an agent or the config file, see [Workspace scope](#workspace-scope).

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

## License

MIT. [zvec-grep](https://github.com/zvec-ai/zvec-grep) and [zvec](https://github.com/alibaba/zvec) are separate Apache-2.0 projects distributed by their respective maintainers.
