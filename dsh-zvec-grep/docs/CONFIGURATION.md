# Configuring dsh-zvec-grep

The plugin has two configuration layers:

1. **Profile assembly config** — global defaults, set once in the profile's plugin config (YAML).
2. **Per-workspace `config.json`** — persisted per workspace, written by the settings toggle, the `zvec_manage` tool, or by hand. This is the file most users touch.

## Per-workspace config: `<workspace>/.zvec-grep/config.json`

```jsonc
// Minimal: just turn indexing on
{ "enabled": true }

// Full example
{
  "enabled": true,
  "recencyBoost": false,
  "scope": {
    "excludePaths": ["src/vendor/**", "docs/generated/**"],
    "maxDepth": 12
  }
}
```

The file is plain JSON. You can edit it while Harness is running — changes take effect on the next index pass or session start, no restart needed.

### Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | *(see rules below)* | Authoritative on/off switch for this workspace's index. |
| `scope` | object | `{}` (engine defaults) | Which files the index covers. See [Workspace scope](#workspace-scope). |
| `recencyBoost` | boolean | `false` | Opt-in recency weighting for `zvec_search`. See [recencyBoost](#recencyboost). |

### Enablement rules

Which workspaces get indexed is evaluated in this order:

1. `config.json` carrying a boolean `enabled` field is **authoritative forever** — a workspace disabled here stays off across plugin and engine upgrades.
2. Without `config.json`, a workspace that already has an engine `manifest.json` predates the toggle and **stays enabled**, so upgrading never silently turns off existing setups.
3. Neither file exists: the workspace follows the `defaultEnabled` option (off by default).

Deleting the whole `.zvec-grep/` directory returns the workspace to the default state; re-enabling rebuilds the index.

### Robustness rules

- A **malformed or unreadable `config.json`** is treated as missing: the workspace falls back to rule 2/3 above. A broken config never strands a working workspace on the wrong side of the toggle.
- **Unknown top-level fields are dropped**; `enabled` and `recencyBoost` must be JSON booleans.
- **`scope` fields are type-checked individually**: a field with the wrong type is dropped, and a scope object with no valid field at all is discarded entirely (the workspace runs on engine defaults).
- Note that `"scope": {}` (an empty object) carries no information and is **not persisted** — write at least one scope field to make the key meaningful.

## Workspace scope

`scope` controls which files the index covers, per workspace. Field names mirror the engine's filter set:

| Field | Type | Meaning |
|---|---|---|
| `includePaths` | string[] | Workspace-relative paths/globs to restrict indexing to. |
| `excludePaths` | string[] | Workspace-relative paths/globs to never index or search. |
| `globs` | string[] | Additional include globs. |
| `insensitiveGlobs` | string[] | Case-insensitive include globs. |
| `fileTypes` | string[] | Restrict to these file extensions. |
| `excludedFileTypes` | string[] | Never index these file extensions. |
| `ignoreFiles` | string[] | Ignore-file names (gitignore-style) the engine should honor. |
| `maxDepth` | number | Maximum directory depth for scanning. |
| `maxFileSizeBytes` | number | Skip files larger than this. |
| `embeddingConcurrency` | number | Parallelism for embedding work. |
| `follow` | boolean | Follow symlinks. |
| `hidden` | boolean | Include hidden files/directories. |
| `noIgnore` | boolean | Disable the engine's built-in ignore rules. |

`excludePaths` matching follows engine semantics: a bare directory name matches only a directory at the workspace root (`secret` excludes `secret/**`), so nested directories need a prefix glob such as `src/vendor/**` or `docs/generated/**`.

### Merge rules

The workspace scope merges over the plugin-global config on every engine call:

- workspace `excludePaths` are **unioned** with the plugin-global `excludePaths`;
- every other scope field **replaces** the global default for that workspace.

Every index pass sends the complete merged scope with a path-filter reset, so the engine's persisted manifest always mirrors the current scope — clearing a scope field really clears it, and edits take effect on the next index pass **without restarting Harness**.

## recencyBoost

Opt-in recency weighting for `zvec_search`. Set `"recencyBoost": true` in the workspace `config.json` to bump the score of results whose file changed since the workspace was activated — a tie-break-sized nudge (`+0.01`) that surfaces files you have been editing without reordering the engine's ranked results.

- Off by default; per workspace.
- Never applies to rg-fallback results, which carry no engine score.
- The change set is capped (LRU, 500 paths) and survives index refreshes; it resets when the workspace is deactivated or dropped.
- `zvec_manage status` reports the current flag.

## Managing config with `zvec_manage`

| Action | Effect on `config.json` / index |
|---|---|
| `enable` | Writes `"enabled": true` and starts indexing in the background. |
| `disable` | Writes `"enabled": false` and stops indexing (config and index stay on disk). |
| `status` | Read-only: reports `enabled`, index phase, configured `scope`, and `recencyBoost`. |
| `rebuild` | Queues a full re-embed; config untouched. |
| `drop` | Deletes index storage (manifest, embedding stores); **keeps `config.json`**, so enablement and scope survive. |
| `scope` | With no argument: reads the current scope. With a `scope` object: **replaces** the persisted scope wholesale (no deep merge) and queues a rescan. |

All actions operate on the calling session's own workspace.

## Profile assembly config

Global defaults, set once in the profile's plugin configuration:

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

| Option | Meaning |
|---|---|
| `engineModule` | Engine package specifier, filesystem path, or `file:` URL. Resolved lazily: explicit location, then bare specifier, then the global npm root. |
| `embedding` | Embedding model. `local/...` models are downloaded once on first use. |
| `device` | `auto`, `cpu`, `metal`, `vulkan`, or `cuda`. |
| `excludePaths` | Plugin-global exclusion list (unioned with each workspace's `scope.excludePaths`). |
| `defaultEnabled` | Enablement for workspaces with **no** `config.json` and **no** existing index. |
| `defaultLimit` / `maxLimit` | Default and maximum result count for `zvec_search`. |
| `watchDebounceMs` | Debounce window for coalescing watcher events into incremental updates. |
| `reconcileIntervalMs` | Full-reconciliation interval; `0` disables it. Default: one hour. |
| `statusPollIntervalMs` | Workspace-status UI refresh interval. Default: two seconds. |

`defaultEnabled` only applies to brand-new workspaces — see [Enablement rules](#enablement-rules). Workspaces you have explicitly enabled or disabled stay that way regardless of this option.
