import z from "@deepseek-ai/schemastery";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/engine.ts
/** Default `engineModule` value: install the engine as an ordinary dependency. */
const DEFAULT_ENGINE_MODULE = "@zvec/zvec-grep";
/** Mirrors `optionalDependencies` in package.json; asserted by tests/package-metadata.test.ts. */
const ENGINE_RANGE = "^0.2.1";
const ENGINE_INSTALL_COMMAND = "npm install -g @zvec/zvec-grep";
/** How long a failed resolution is reused before another probe is allowed. */
const ENGINE_RETRY_INTERVAL_MS = 3e4;
var EngineUnavailableError = class extends Error {
	constructor(attempts) {
		super([
			"dsh-zvec-grep: the optional zvec-grep engine is not installed, so semantic search is unavailable.",
			`Run: ${ENGINE_INSTALL_COMMAND}`,
			"Then call zvec_search again. Do not retry zvec_search before the engine is installed.",
			`If the engine is installed elsewhere, point the plugin option "engineModule" at its entry file, for example: ${DEFAULT_ENGINE_MODULE}`,
			...attempts.length === 0 ? [] : [`Failed attempts: ${attempts.join("; ")}`]
		].join("\n"));
		this.attempts = attempts;
		this.name = "EngineUnavailableError";
	}
};
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const NPM_ROOT_TIMEOUT_MS = 1e4;
function errorMessage$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/** True for anything the plugin should treat as a filesystem location rather than a package name. */
function isPathLike(specifier) {
	return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\") || specifier.startsWith("file:") || WINDOWS_DRIVE.test(specifier);
}
function pickCondition(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const picked = pickCondition(item);
			if (picked !== void 0) return picked;
		}
		return;
	}
	if (value === null || typeof value !== "object") return void 0;
	const conditions = value;
	for (const key of [
		"import",
		"module",
		"default",
		"require",
		"node"
	]) {
		const picked = pickCondition(conditions[key]);
		if (picked !== void 0) return picked;
	}
}
/** Reads a package directory's declared entry point and version, mirroring Node's ESM conditions. */
async function readPackageEntry(directory) {
	let manifest;
	try {
		manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
	} catch {
		return;
	}
	const exports = manifest.exports;
	const entry = pickCondition(exports !== null && typeof exports === "object" && !Array.isArray(exports) ? exports["."] ?? exports : exports) ?? (typeof manifest.main === "string" ? manifest.main : void 0);
	if (entry === void 0) return void 0;
	return {
		url: pathToFileURL(resolve(directory, entry)).href,
		...typeof manifest.version === "string" ? { version: manifest.version } : {}
	};
}
/** Extracts the install directory of a package specifier inside a node_modules root. */
function packageDirectory(root, specifier) {
	const [first, second] = specifier.split("/");
	if (first === void 0 || first === "") return void 0;
	if (!first.startsWith("@")) return join(root, first);
	if (second === void 0 || second === "") return void 0;
	return join(root, first, second);
}
/** Resolves the global npm root once, walking past any wrapper banner lines npm may print. */
async function readGlobalNpmRoot(run) {
	try {
		return (await run("npm", ["root", "-g"])).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "").at(-1);
	} catch {
		return;
	}
}
function defaultRunner(command, args) {
	const windows = process.platform === "win32";
	const file = windows ? process.env.ComSpec ?? "cmd.exe" : command;
	const argv = windows ? [
		"/d",
		"/c",
		command,
		...args
	] : [...args];
	return new Promise((resolveOutput, rejectOutput) => {
		execFile(file, argv, {
			windowsHide: true,
			timeout: NPM_ROOT_TIMEOUT_MS,
			encoding: "utf8"
		}, (error, stdout) => {
			if (error) {
				rejectOutput(error);
				return;
			}
			resolveOutput(String(stdout));
		});
	});
}
function engineFactory(module) {
	if (module === null || typeof module !== "object") return void 0;
	const namespace = module;
	if (typeof namespace.createZvecGrep === "function") return namespace.createZvecGrep;
	const defaultExport = namespace.default;
	if (defaultExport !== null && typeof defaultExport === "object") {
		const nested = defaultExport.createZvecGrep;
		if (typeof nested === "function") return nested;
	}
}
/**
* Resolves the optional engine package lazily, so a missing or broken engine never prevents
* the plugin from loading. Resolution order: an explicit path, the bare specifier (which covers
* the engine installed next to the plugin), then the global npm root.
*/
var EngineLoader = class {
	specifier;
	retryIntervalMs;
	importModule;
	readGlobalRoot;
	onWarning;
	now;
	globalRoot;
	loaded;
	inflight;
	failure;
	constructor(options) {
		this.specifier = options.specifier;
		this.retryIntervalMs = options.retryIntervalMs ?? ENGINE_RETRY_INTERVAL_MS;
		this.importModule = options.importModule ?? ((specifier) => import(specifier));
		this.readGlobalRoot = options.readGlobalRoot ?? (() => readGlobalNpmRoot(defaultRunner));
		this.onWarning = options.onWarning;
		this.now = options.now ?? Date.now;
	}
	load() {
		if (this.loaded !== void 0) return this.loaded;
		if (this.inflight !== void 0) return this.inflight;
		if (this.failure !== void 0 && this.now() < this.failure.retryAt) return Promise.reject(this.failure.error);
		const attempt = this.resolve();
		this.inflight = attempt;
		attempt.then(() => {
			this.loaded = attempt;
			this.failure = void 0;
		}, (error) => {
			this.failure = {
				retryAt: this.now() + this.retryIntervalMs,
				error: error instanceof EngineUnavailableError ? error : new EngineUnavailableError([errorMessage$1(error)])
			};
		}).finally(() => {
			if (this.inflight === attempt) this.inflight = void 0;
		});
		return attempt;
	}
	async resolve() {
		const attempts = [];
		const explicit = isPathLike(this.specifier);
		const primary = await this.primaryCandidates(explicit).catch((error) => {
			attempts.push(`the configured engine location could not be read (${errorMessage$1(error)})`);
			return [];
		});
		for (const candidate of primary) {
			const loaded = await this.attempt(candidate, attempts);
			if (loaded !== void 0) return loaded;
		}
		if (explicit) throw new EngineUnavailableError(attempts);
		const global = await this.globalCandidates().catch((error) => {
			attempts.push(`the global npm root could not be read (${errorMessage$1(error)})`);
			return [];
		});
		for (const candidate of global) {
			const loaded = await this.attempt(candidate, attempts);
			if (loaded !== void 0) return loaded;
		}
		throw new EngineUnavailableError(attempts);
	}
	/** Loads one candidate, recording why it failed instead of aborting the remaining candidates. */
	async attempt(candidate, attempts) {
		try {
			const factory = engineFactory(await this.importModule(candidate.specifier));
			if (factory === void 0) throw new Error("module does not export createZvecGrep");
			this.checkVersion(candidate);
			return { createZvecGrep: async (options) => await factory(options) };
		} catch (error) {
			attempts.push(`${candidate.label} (${errorMessage$1(error)})`);
			return;
		}
	}
	async primaryCandidates(explicit) {
		if (!explicit) return [{
			label: this.specifier,
			specifier: this.specifier
		}];
		const target = this.specifier.startsWith("file:") ? fileURLToPath(this.specifier) : resolve(this.specifier);
		const entry = await readPackageEntry(target);
		return entry === void 0 ? [{
			label: this.specifier,
			specifier: pathToFileURL(target).href
		}] : [{
			label: this.specifier,
			specifier: entry.url,
			...entry.version === void 0 ? {} : { version: entry.version }
		}];
	}
	async globalCandidates() {
		const root = await this.globalNpmRoot();
		if (root === void 0) return [];
		const directory = packageDirectory(root, this.specifier);
		if (directory === void 0) return [];
		const entry = await readPackageEntry(directory);
		if (entry === void 0) return [];
		return [{
			label: `${this.specifier} from ${root}`,
			specifier: entry.url,
			...entry.version === void 0 ? {} : { version: entry.version }
		}];
	}
	globalNpmRoot() {
		this.globalRoot ??= this.readGlobalRoot();
		return this.globalRoot;
	}
	checkVersion(candidate) {
		if (candidate.version === void 0 || this.onWarning === void 0) return;
		const expected = ENGINE_RANGE.replace(/^[^\d]*/, "").split(".")[0];
		if (expected === void 0 || expected === "" || candidate.version.split(".")[0] === expected) return;
		this.onWarning(`dsh-zvec-grep: resolved @zvec/zvec-grep ${candidate.version} from ${candidate.label}, which is outside the tested range ${ENGINE_RANGE}`);
	}
};

//#endregion
//#region src/config-file.ts
/** Directory under each workspace root that stores this plugin's persistent state. */
const INDEX_DIR_NAME = ".zvec-grep";
function indexDir(root) {
	return join(root, INDEX_DIR_NAME);
}
function workspaceConfigPath(root) {
	return join(indexDir(root), "config.json");
}
function workspaceManifestPath(root) {
	return join(indexDir(root), "manifest.json");
}
const STRING_ARRAY_KEYS = [
	"includePaths",
	"excludePaths",
	"globs",
	"insensitiveGlobs",
	"fileTypes",
	"excludedFileTypes",
	"ignoreFiles"
];
const NUMBER_KEYS = [
	"maxDepth",
	"maxFileSizeBytes",
	"embeddingConcurrency"
];
const BOOLEAN_KEYS = [
	"follow",
	"hidden",
	"noIgnore"
];
/** Keeps only well-typed scope fields; an empty or malformed object yields `undefined`. */
function sanitizeScope(input) {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return void 0;
	const source = input;
	const scope = {};
	let kept = false;
	for (const key of STRING_ARRAY_KEYS) {
		const value = source[key];
		if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)) {
			scope[key] = value;
			kept = true;
		}
	}
	for (const key of NUMBER_KEYS) {
		const value = source[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			scope[key] = value;
			kept = true;
		}
	}
	for (const key of BOOLEAN_KEYS) {
		const value = source[key];
		if (typeof value === "boolean") {
			scope[key] = value;
			kept = true;
		}
	}
	return kept ? scope : void 0;
}
function canonicalizeRoot(root) {
	const absolute = resolve(root);
	try {
		return realpathSync.native(absolute);
	} catch {
		return absolute;
	}
}
/**
* Reads `.zvec-grep/config.json`. Returns `undefined` when the file is missing or unreadable;
* a malformed file is treated the same way so a broken config never strands a working
* workspace on the wrong side of the toggle. Unknown or malformed scope fields are dropped.
*/
function readWorkspaceConfig(root) {
	try {
		const parsed = JSON.parse(readFileSync(workspaceConfigPath(root), "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
		const source = parsed;
		const config = {};
		if (typeof source.enabled === "boolean") config.enabled = source.enabled;
		const scope = sanitizeScope(source.scope);
		if (scope) config.scope = scope;
		return config.enabled !== void 0 || config.scope !== void 0 ? config : {};
	} catch {
		return;
	}
}
/** Writes the whole config file; fields left `undefined` are omitted. */
function writeWorkspaceConfig(root, config) {
	mkdirSync(indexDir(root), { recursive: true });
	writeFileSync(workspaceConfigPath(root), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
/**
* Merges one patch into the persisted config: `enabled` and `scope` are independent, and a
* `scope` patch replaces the previous scope wholesale (no deep merge, so clearing a field
* really clears it).
*/
function updateWorkspaceConfig(root, patch) {
	const next = {
		...readWorkspaceConfig(root),
		...patch
	};
	if (next.scope === void 0) delete next.scope;
	writeWorkspaceConfig(root, next);
	return next;
}
/**
* Enablement rules, oldest behavior first:
*
* 1. `config.json` carrying a boolean `enabled` field is authoritative forever, so a workspace
*    explicitly disabled through the pill stays off across plugin and engine upgrades.
* 2. Without `config.json`, a workspace that already has an engine `manifest.json` predates the
*    toggle and stays enabled - every workspace the previous version ever indexed has one, so
*    existing setups keep working without manual migration.
* 3. Neither file exists: a brand-new workspace follows `defaultEnabled` (off unless opted in).
*/
function resolveEnabled(root, defaultEnabled) {
	const config = readWorkspaceConfig(root);
	if (config?.enabled !== void 0) return config.enabled;
	if (existsSync(workspaceManifestPath(root))) return true;
	return defaultEnabled;
}
/**
* Drops the workspace index but keeps `config.json`, so enablement and scope survive a drop.
* Everything else under `.zvec-grep/` (manifest, embedding stores, locks) is engine state and
* is regenerated on the next activation. Used when the workspace may be disabled and therefore
* has no live engine instance to call `dropIndex()` on.
*/
function dropWorkspaceIndexStorage(root) {
	const dir = indexDir(root);
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) if (entry !== "config.json") rmSync(join(dir, entry), {
		recursive: true,
		force: true
	});
}

//#endregion
//#region src/runtime.ts
const statusMessages = {
	indexing: "The workspace index is still being built.",
	refreshing: "The workspace index is being refreshed in the background.",
	disabled: "Zvec indexing is disabled for this workspace. Enable it from the Zvec status pill, or by setting \"enabled\": true in the workspace .zvec-grep/config.json."
};
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
var WorkspaceSearchRuntime = class {
	workspaces = /* @__PURE__ */ new Map();
	constructor(options) {
		this.options = options;
	}
	activate(root) {
		root = canonicalizeRoot(root);
		const existing = this.workspaces.get(root);
		if (existing) return existing.initialIndex;
		if (this.options.enabled !== void 0 && !this.options.enabled(root)) return Promise.resolve();
		const state = {
			root,
			engine: this.options.create(root),
			initialIndex: Promise.resolve(),
			controller: new AbortController(),
			phase: "indexing",
			updatedAt: Date.now(),
			changedPaths: /* @__PURE__ */ new Set(),
			fullReconcile: false,
			pendingRebuild: false,
			engineFailed: false
		};
		this.workspaces.set(root, state);
		this.startWatcher(state);
		state.initialIndex = this.indexInitially(state);
		return state.initialIndex;
	}
	settled(root) {
		root = canonicalizeRoot(root);
		const state = this.workspaces.get(root);
		if (!state) throw new Error(`Workspace is not active: ${root}`);
		return state.initialIndex;
	}
	status() {
		return [...this.workspaces.values()].map((state) => ({
			root: state.root,
			status: state.phase,
			pendingChanges: state.changedPaths.size + (state.fullReconcile ? 1 : 0),
			updatedAt: state.updatedAt,
			...state.progress ? { progress: state.progress } : {},
			...state.phase === "error" ? { message: errorMessage(state.error) } : {}
		}));
	}
	statusFor(root) {
		root = canonicalizeRoot(root);
		return this.status().find((status) => status.root === root);
	}
	async search(root, options) {
		root = canonicalizeRoot(root);
		let state = this.workspaces.get(root);
		if (!state) {
			if (this.options.enabled !== void 0 && !this.options.enabled(root)) return {
				status: "disabled",
				root,
				message: statusMessages.disabled
			};
			this.activate(root).catch(() => void 0);
			state = this.workspaces.get(root);
		}
		if (state.phase === "error" && state.engineFailed) await this.reactivate(state);
		if (state.phase === "indexing") return {
			status: "indexing",
			root,
			message: statusMessages.indexing
		};
		if (state.phase === "refreshing") return {
			status: "refreshing",
			root,
			message: statusMessages.refreshing
		};
		if (state.phase === "error") return {
			status: "error",
			root,
			message: errorMessage(state.error)
		};
		return {
			status: "ready",
			result: await (await state.engine).context({
				...options,
				root,
				autoUpdate: false,
				...this.engineOptions(root)
			})
		};
	}
	/**
	* Re-attempts engine resolution for a workspace whose engine never loaded. The engine loader
	* decides whether another probe is allowed yet, so repeated searches stay cheap. Indexing is
	* restarted in the background; the caller still returns immediately.
	*/
	async reactivate(state) {
		const engine = this.options.create(state.root);
		state.engine = engine;
		try {
			await engine;
		} catch {
			return;
		}
		state.engineFailed = false;
		state.error = void 0;
		this.setPhase(state, "indexing");
		state.initialIndex = this.indexInitially(state);
		state.initialIndex.catch(() => void 0);
	}
	/**
	* Tears one workspace down: aborts in-flight work, closes its watcher and engine, and removes
	* it from the runtime so a later search lazily re-activates it from scratch.
	*/
	async deactivate(root) {
		root = canonicalizeRoot(root);
		const state = this.workspaces.get(root);
		if (!state) return;
		this.workspaces.delete(root);
		await this.disposeState(state, "dsh-zvec-grep workspace disabled");
	}
	/**
	* Queues a full rescan that rewrites the manifest filters without re-embedding everything -
	* the right response to a scope edit, where included files can keep their embeddings.
	*/
	reconcile(root) {
		root = canonicalizeRoot(root);
		const state = this.workspaces.get(root);
		if (!state) return;
		this.queueReconcile(state);
	}
	/**
	* Queues a full rebuild (re-embed everything) through the normal refresh pipeline, so it
	* cooperates with in-flight refreshes and the watcher instead of racing them.
	*/
	rebuild(root) {
		root = canonicalizeRoot(root);
		const state = this.workspaces.get(root);
		if (!state) return;
		state.pendingRebuild = true;
		this.queueReconcile(state);
	}
	/**
	* Drops the workspace index storage (manifest + embedding stores, not `config.json`) and
	* deactivates the workspace, so the next activation re-indexes from scratch. Works on
	* disabled workspaces too, where there is no live engine to call `dropIndex()` on.
	*/
	async drop(root) {
		root = canonicalizeRoot(root);
		await this.deactivate(root);
		dropWorkspaceIndexStorage(root);
	}
	async close() {
		const states = [...this.workspaces.values()];
		this.workspaces.clear();
		await Promise.allSettled(states.map((state) => this.disposeState(state, "dsh-zvec-grep disposed")));
	}
	async disposeState(state, reason) {
		state.controller.abort(new Error(reason));
		if (state.debounceTimer) clearTimeout(state.debounceTimer);
		if (state.reconcileTimer) clearInterval(state.reconcileTimer);
		await Promise.resolve(state.watcher?.close()).catch(() => void 0);
		await Promise.allSettled([state.initialIndex, state.refresh].filter((task) => Boolean(task)));
		try {
			await (await state.engine).close();
		} catch {}
	}
	startWatcher(state) {
		if (this.options.watch) state.watcher = this.options.watch(state.root, {
			change: (path) => this.queuePath(state, path),
			error: () => this.queueReconcile(state)
		});
		const intervalMs = this.options.reconcileIntervalMs ?? 60 * 6e4;
		if (intervalMs > 0) {
			state.reconcileTimer = setInterval(() => this.queueReconcile(state), intervalMs);
			state.reconcileTimer.unref?.();
		}
	}
	async indexInitially(state) {
		try {
			await state.watcher?.ready;
			state.controller.signal.throwIfAborted();
			await (await state.engine).index({
				root: state.root,
				signal: state.controller.signal,
				resetPaths: true,
				onProgress: (progress) => this.recordProgress(state, progress),
				...this.engineOptions(state.root)
			});
			this.setPhase(state, state.changedPaths.size > 0 || state.fullReconcile ? "refreshing" : "ready");
			state.error = void 0;
			state.engineFailed = false;
			if (state.phase === "refreshing") this.scheduleRefresh(state);
		} catch (error) {
			await this.failWorkspace(state, error);
			throw error;
		}
	}
	async failWorkspace(state, error) {
		this.setPhase(state, "error");
		state.error = error;
		state.engineFailed = await state.engine.then(() => false, () => true);
	}
	queuePath(state, path) {
		if (state.controller.signal.aborted || state.engineFailed) return;
		state.changedPaths.add(path);
		if (state.phase !== "indexing") this.setPhase(state, "refreshing");
		this.scheduleRefresh(state);
	}
	queueReconcile(state) {
		if (state.controller.signal.aborted || state.engineFailed) return;
		state.fullReconcile = true;
		if (state.phase !== "indexing") this.setPhase(state, "refreshing");
		this.scheduleRefresh(state);
	}
	scheduleRefresh(state) {
		if (state.phase === "indexing" || state.refresh || state.controller.signal.aborted) return;
		if (state.debounceTimer) clearTimeout(state.debounceTimer);
		state.debounceTimer = setTimeout(() => {
			state.debounceTimer = void 0;
			state.refresh = this.refresh(state).finally(() => {
				state.refresh = void 0;
				if (state.changedPaths.size > 0 || state.fullReconcile) this.scheduleRefresh(state);
			});
		}, this.options.debounceMs ?? 750);
		state.debounceTimer.unref?.();
	}
	async refresh(state) {
		const fullReconcile = state.fullReconcile;
		const rebuild = state.pendingRebuild;
		const changedPaths = [...state.changedPaths];
		state.fullReconcile = false;
		state.pendingRebuild = false;
		state.changedPaths.clear();
		try {
			await (await state.engine).index({
				root: state.root,
				signal: state.controller.signal,
				onProgress: (progress) => this.recordProgress(state, progress),
				...fullReconcile ? { resetPaths: true } : {},
				...rebuild ? { rebuild: true } : {},
				...fullReconcile || rebuild ? {} : { changedPaths },
				...this.engineOptions(state.root)
			});
			this.setPhase(state, state.changedPaths.size > 0 || state.fullReconcile ? "refreshing" : "ready");
			state.error = void 0;
		} catch (error) {
			if (!state.controller.signal.aborted) await this.failWorkspace(state, error);
		}
	}
	setPhase(state, phase) {
		if (state.phase === phase) return;
		state.phase = phase;
		state.updatedAt = Date.now();
	}
	/**
	* Stores the latest engine index progress for status polling. The engine owns the snapshot it
	* passes in, so the runtime keeps its own shallow copy and never mutates or exposes it further.
	*/
	recordProgress(state, progress) {
		if (state.controller.signal.aborted) return;
		state.progress = {
			...progress,
			...progress.embedding === void 0 ? {} : { embedding: { ...progress.embedding } }
		};
	}
	/**
	* The engine options for one workspace, recomputed per call: global `excludePaths` plus the
	* workspace scope, so a config edit takes effect without deactivating the workspace. Every
	* index pass sends the complete merged scope with `resetPaths`, because the engine inherits
	* omitted filter keys from its manifest - without the reset, a cleared scope field would
	* keep its old persisted value forever.
	*/
	engineOptions(root) {
		const scope = this.options.scope?.(root) ?? {};
		const excludePaths = [...this.options.excludePaths ?? [], ...scope.excludePaths ?? []];
		return excludePaths.length > 0 ? {
			...scope,
			excludePaths
		} : { ...scope };
	}
};

//#endregion
//#region src/tool.ts
function lineRange(item) {
	const range = item.excerptRange ?? item.range;
	if ("startLine" in range && "endLine" in range) return {
		startLine: range.startLine,
		endLine: range.endLine
	};
	if ("page" in range) return {
		startLine: range.page,
		endLine: range.page
	};
	return {};
}
function projectResult(result) {
	return {
		status: "ready",
		query: result.query,
		root: result.root,
		source: result.source,
		coverage: result.coverage,
		results: result.items.map((item) => ({
			path: item.file.relativePath,
			...lineRange(item),
			content: item.content,
			status: item.status,
			matchedBy: Array.isArray(item.matchedBy) ? item.matchedBy.join(",") : String(item.matchedBy),
			...item.score === void 0 ? {} : { score: item.score },
			...item.metadata === void 0 ? {} : { metadata: projectMetadata(item.metadata) },
			...item.trace === void 0 ? {} : { trace: projectTrace(item.trace) }
		}))
	};
}
function project(outcome) {
	return outcome.status === "ready" ? projectResult(outcome.result) : outcome;
}
function parseModifiedTime(value, name$1) {
	if (value === void 0) return void 0;
	const time = Date.parse(String(value));
	if (Number.isNaN(time)) throw new Error(`zvec_search ${name$1} must be an ISO 8601 timestamp or date, got: ${String(value)}`);
	return time;
}
const ZVEC_SYMBOL_TYPES = [
	"module",
	"class",
	"interface",
	"function",
	"value",
	"alias"
];
function parseSymbolTypes(value) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value)) throw new Error("zvec_search symbolTypes must be an array of symbol types");
	for (const entry of value) if (typeof entry !== "string" || !ZVEC_SYMBOL_TYPES.includes(entry)) throw new Error(`zvec_search symbolTypes accepts only: ${ZVEC_SYMBOL_TYPES.join(", ")}`);
	return [...new Set(value)];
}
/** Drops nullish keys recursively so engine data never reaches the host as undefined values. */
function pruneNullish(value) {
	if (Array.isArray(value)) return value.map((item) => pruneNullish(item));
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const [key, entry] of Object.entries(value)) if (entry !== void 0 && entry !== null) out[key] = pruneNullish(entry);
		return out;
	}
	return value;
}
function projectMetadata(metadata) {
	if (metadata.kind === "code") return {
		kind: metadata.kind,
		symbolType: metadata.symbolType,
		...metadata.symbolName === null ? {} : { symbolName: metadata.symbolName },
		...metadata.scope === null ? {} : { scope: metadata.scope },
		...metadata.signature === null ? {} : { signature: metadata.signature },
		...metadata.doc === null ? {} : { doc: metadata.doc },
		modifiers: [...metadata.modifiers]
	};
	return {
		kind: metadata.kind,
		...metadata.heading === null ? {} : { heading: metadata.heading },
		...metadata.level === null ? {} : { level: metadata.level },
		...metadata.scope === null ? {} : { scope: metadata.scope }
	};
}
function projectTrace(trace) {
	return {
		recall: trace.recall.map((entry) => pruneNullish({ ...entry })),
		...trace.fusion === void 0 ? {} : { fusion: pruneNullish({ ...trace.fusion }) },
		...trace.ranking === void 0 ? {} : { ranking: pruneNullish({ ...trace.ranking }) },
		final: pruneNullish({ ...trace.final })
	};
}
function createSearchTool(runtime, config) {
	return defineTool({
		name: "zvec_search",
		description: "Search the current workspace by meaning, concepts, architecture, relationships, and data flow. Returns indexing or refreshing status immediately when the background index is not ready, and an error status carrying the install command when the optional zvec-grep engine is not available. A disabled status means the user turned indexing off for this workspace; do not retry, mention they can enable it from the Zvec status pill. Use exact grep for known literals or exhaustive matches.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "Natural-language search intent."
			},
			limit: {
				type: "integer",
				description: `Maximum results, from 1 to ${config.maxLimit}. Defaults to ${config.defaultLimit}.`
			},
			modifiedAfter: {
				type: "string",
				description: "Only include files modified at or after this time: an ISO 8601 date or timestamp, e.g. 2026-09-15 or 2026-09-15T10:00:00Z."
			},
			modifiedBefore: {
				type: "string",
				description: "Only include files modified at or before this time: an ISO 8601 date or timestamp."
			},
			trace: {
				type: "boolean",
				description: "Include per-hit retrieval diagnostics (recall routes, fusion, ranking) on each result; use to debug retrieval quality."
			},
			preferSymbol: {
				type: "boolean",
				description: "Prefer indexed code symbols over surrounding prose fragments."
			},
			symbolTypes: {
				type: "array",
				description: `With preferSymbol, restrict the symbol preference to these types: ${ZVEC_SYMBOL_TYPES.join(", ")}.`
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					status: {
						type: "string",
						required: true
					},
					root: {
						type: "string",
						required: true
					},
					message: { type: "string" },
					query: { type: "string" },
					source: { type: "string" },
					coverage: { type: "string" },
					results: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: {
									type: "string",
									required: true
								},
								startLine: { type: "integer" },
								endLine: { type: "integer" },
								content: {
									type: "string",
									required: true
								},
								status: {
									type: "string",
									required: true
								},
								matchedBy: {
									type: "string",
									required: true
								},
								score: { type: "number" },
								metadata: {
									type: "object",
									additionalProperties: false,
									properties: {
										kind: {
											type: "string",
											required: true
										},
										symbolType: { type: "string" },
										symbolName: { type: "string" },
										scope: { type: "string" },
										signature: { type: "string" },
										doc: { type: "string" },
										modifiers: {
											type: "array",
											items: { type: "string" }
										},
										heading: { type: "string" },
										level: { type: "integer" }
									}
								},
								trace: {
									type: "object",
									additionalProperties: false,
									properties: {
										recall: {
											type: "array",
											items: {
												type: "object",
												additionalProperties: false,
												properties: {
													path: {
														type: "string",
														required: true
													},
													routeId: { type: "string" },
													query: { type: "string" },
													found: {
														type: "boolean",
														required: true
													},
													forced: { type: "boolean" },
													rank: { type: "integer" },
													score: { type: "number" },
													reason: { type: "string" }
												}
											}
										},
										fusion: {
											type: "object",
											additionalProperties: false,
											properties: {
												rank: {
													type: "integer",
													required: true
												},
												score: {
													type: "number",
													required: true
												},
												forced: { type: "boolean" }
											}
										},
										ranking: {
											type: "object",
											additionalProperties: false,
											properties: {
												rank: {
													type: "integer",
													required: true
												},
												score: {
													type: "number",
													required: true
												},
												forced: { type: "boolean" }
											}
										},
										final: {
											type: "object",
											additionalProperties: false,
											properties: {
												returnedByLimit: {
													type: "boolean",
													required: true
												},
												cutoffRank: {
													type: "integer",
													required: true
												}
											}
										}
									}
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args, exec) {
			const root = exec.agent?.session.header.cwd;
			if (!root) throw new Error("zvec_search requires a session workspace");
			const limit = args.limit ?? config.defaultLimit;
			if (limit < 1 || limit > config.maxLimit) throw new Error(`zvec_search limit must be between 1 and ${config.maxLimit}`);
			const modifiedAfter = parseModifiedTime(args.modifiedAfter, "modifiedAfter");
			const modifiedBefore = parseModifiedTime(args.modifiedBefore, "modifiedBefore");
			if (modifiedAfter !== void 0 && modifiedBefore !== void 0 && modifiedAfter > modifiedBefore) throw new Error("zvec_search modifiedAfter must not be later than modifiedBefore");
			const symbolTypes = parseSymbolTypes(args.symbolTypes);
			return project(await runtime.search(root, {
				query: args.query,
				limit,
				...args.trace === void 0 ? {} : { trace: args.trace },
				...args.preferSymbol === void 0 ? {} : { preferSymbol: args.preferSymbol },
				...symbolTypes === void 0 ? {} : { symbolTypes },
				...modifiedAfter === void 0 ? {} : { modifiedAfter },
				...modifiedBefore === void 0 ? {} : { modifiedBefore }
			}));
		}
	});
}

//#endregion
//#region src/manage-tool.ts
const SCOPE_DESCRIPTION = [
	"Per-workspace index scope. Fields (all optional):",
	"includePaths/excludePaths/globs/insensitiveGlobs/fileTypes/excludedFileTypes/ignoreFiles: string arrays;",
	"maxDepth/maxFileSizeBytes/embeddingConcurrency: numbers;",
	"follow/hidden/noIgnore: booleans.",
	"excludePaths follows engine semantics: a bare name matches only a root-level directory; nested paths need a prefix glob like \"src/vendor/**\".",
	"Setting a scope replaces the previous one wholesale and queues a rescan; omitting the parameter returns the current scope."
].join(" ");
/** True when the value looks like a scope object (at least one own key). */
function isScopeInput(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
function createManageTool(deps) {
	return defineTool({
		name: "zvec_manage",
		description: "Manage the zvec-grep workspace index of the current session workspace: enable or disable indexing, check its status, queue a rescan or full rebuild, drop the index, or read and set the per-workspace scope (which files the index covers). The user turned indexing off for this workspace unless it was enabled explicitly; enable it before searching.",
		parameters: {
			action: {
				type: "string",
				required: true,
				description: "One of: enable, disable, status, rebuild, drop, scope."
			},
			scope: {
				type: "object",
				additionalProperties: true,
				description: SCOPE_DESCRIPTION
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					action: {
						type: "string",
						required: true
					},
					root: {
						type: "string",
						required: true
					},
					enabled: { type: "boolean" },
					phase: { type: "string" },
					scope: { type: "json" },
					configPath: { type: "string" },
					message: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args, exec) {
			const root = exec.agent?.session.header.cwd;
			if (!root) throw new Error("zvec_manage requires a session workspace");
			const configPath = workspaceConfigPath(root);
			switch (args.action) {
				case "enable":
					updateWorkspaceConfig(root, { enabled: true });
					deps.runtime.activate(root).catch(() => void 0);
					return {
						action: "enable",
						root,
						enabled: true,
						message: "Indexing enabled; the index is being built in the background. Check with action \"status\"."
					};
				case "disable":
					updateWorkspaceConfig(root, { enabled: false });
					await deps.runtime.deactivate(root);
					return {
						action: "disable",
						root,
						enabled: false,
						message: "Indexing disabled; the index stays on disk and is not searched."
					};
				case "rebuild":
					if (!deps.isEnabled(root)) return {
						action: "rebuild",
						root,
						enabled: false,
						message: "Indexing is disabled for this workspace; enable it first."
					};
					if (deps.runtime.statusFor(root) !== void 0) {
						deps.runtime.rebuild(root);
						return {
							action: "rebuild",
							root,
							enabled: true,
							message: "Full rebuild queued; check with action \"status\"."
						};
					}
					deps.runtime.activate(root).catch(() => void 0);
					return {
						action: "rebuild",
						root,
						enabled: true,
						message: "The workspace was not indexed yet; activation with a full index has been started."
					};
				case "drop":
					await deps.runtime.drop(root);
					return {
						action: "drop",
						root,
						message: "Index dropped. Enablement and scope in config.json are kept; the next activation re-indexes from scratch."
					};
				case "scope": {
					const current = readWorkspaceConfig(root)?.scope;
					if (!isScopeInput(args.scope)) return {
						action: "scope",
						root,
						...current !== void 0 ? { scope: current } : {},
						configPath,
						message: "Current scope (empty object means engine defaults apply)."
					};
					const scope = sanitizeScope(args.scope);
					if (!scope) throw new Error("zvec_manage scope contains no valid fields; pass objects like {\"excludePaths\":[\"dist\"]}");
					updateWorkspaceConfig(root, { scope });
					deps.runtime.reconcile(root);
					return {
						action: "scope",
						root,
						scope,
						configPath,
						message: "Scope updated and rescan queued; check with action \"status\"."
					};
				}
				default: {
					const enabled = deps.isEnabled(root);
					const status = deps.runtime.statusFor(root);
					const scope = readWorkspaceConfig(root)?.scope;
					return {
						action: "status",
						root,
						enabled,
						phase: status?.status ?? "inactive",
						...scope !== void 0 ? { scope } : {},
						configPath,
						message: status?.message ?? (enabled ? "Indexing is enabled; the workspace is not active in this session yet and will index on first search." : "Indexing is disabled for this workspace; enable it with action \"enable\".")
					};
				}
			}
		}
	});
}

//#endregion
//#region src/watcher.ts
const HARD_EXCLUDED = /(^|[/\\])(?:\.git|\.zvec-grep|node_modules)(?:[/\\]|$)/;
function changedPath(root, filename) {
	if (filename === null) return void 0;
	const name$1 = filename.toString();
	if (!name$1 || HARD_EXCLUDED.test(name$1)) return void 0;
	const absolutePath = isAbsolute(name$1) ? resolve(name$1) : resolve(root, name$1);
	const pathFromRoot = relative(root, absolutePath);
	if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) return void 0;
	return absolutePath;
}
function createWorkspaceWatcherWith(root, callbacks, nativeWatch) {
	const watcher = nativeWatch(root, { recursive: true }, (_eventType, filename) => {
		const path = changedPath(root, filename);
		if (path !== void 0) callbacks.change(path);
	});
	watcher.on("error", callbacks.error);
	return {
		ready: Promise.resolve(),
		close: () => watcher.close()
	};
}
function createWorkspaceWatcher(root, callbacks) {
	return createWorkspaceWatcherWith(root, callbacks, watch);
}

//#endregion
//#region src/status-route.ts
const STATUS_PATH = "/api/dsh-zvec-grep/status";
function registerStatusRoute(connection, runtime, sessions, pollIntervalMs, isEnabled, getEngine) {
	const route = {
		path: STATUS_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		async fetch() {
			const roots = [...new Set(sessions.list().map((item) => item.header.cwd).filter((cwd) => typeof cwd === "string" && cwd.length > 0))];
			if (roots.length === 0) return new Response("not found", { status: 404 });
			const engine = getEngine === void 0 ? void 0 : await getEngine().catch(() => ({ available: false }));
			const workspaces = roots.map((root) => {
				const config = readWorkspaceConfig(root);
				const shared = {
					enabled: isEnabled(root),
					scope: config?.scope ?? null
				};
				if (!isEnabled(root)) return {
					root,
					status: "disabled",
					pendingChanges: 0,
					updatedAt: 0,
					progress: null,
					...shared
				};
				const internal = runtime.statusFor(root);
				return internal === void 0 ? {
					root,
					status: "indexing",
					pendingChanges: 0,
					updatedAt: 0,
					progress: null,
					...shared
				} : {
					root,
					status: internal.status,
					pendingChanges: internal.pendingChanges,
					updatedAt: internal.updatedAt,
					progress: internal.progress ?? null,
					...internal.status === "error" ? { errorCode: "index_failed" } : {},
					...shared
				};
			});
			return new Response(JSON.stringify({
				version: 5,
				pollIntervalMs,
				...engine === void 0 ? {} : { engine },
				workspaces
			}), {
				status: 200,
				headers: {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store"
				}
			});
		}
	};
	return connection.register(route);
}

//#endregion
//#region src/toggle-route.ts
/** Exact Fetch route the status pill uses to toggle a workspace on or off. */
const TOGGLE_PATH = "/api/dsh-zvec-grep/toggle-workspace";
function validatePayload(payload) {
	const { root, enabled } = payload;
	if (typeof root !== "string" || root.length === 0) return {
		ok: false,
		message: "Toggle requires a non-empty root parameter"
	};
	if (typeof enabled !== "boolean") return {
		ok: false,
		message: "Toggle requires an enabled parameter of true or false"
	};
	return {
		ok: true,
		root,
		enabled
	};
}
async function applyToggle(deps, payload) {
	const parsed = validatePayload(payload);
	if (!parsed.ok) return {
		ok: false,
		error: {
			code: "bad_request",
			message: parsed.message,
			details: {}
		}
	};
	const root = canonicalizeRoot(parsed.root);
	if (!new Set(deps.sessions.list().map((item) => item.header.cwd).filter((cwd) => typeof cwd === "string" && cwd.length > 0).map(canonicalizeRoot)).has(root)) return {
		ok: false,
		error: {
			code: "not_found",
			message: `Workspace is not known to this Harness process: ${root}`,
			details: {}
		}
	};
	updateWorkspaceConfig(root, { enabled: parsed.enabled });
	if (parsed.enabled) deps.runtime.activate(root).catch(() => void 0);
	else await deps.runtime.deactivate(root);
	return {
		ok: true,
		value: {
			root,
			enabled: parsed.enabled
		}
	};
}
/**
* Registers the workspace toggle as an exact Fetch route, the same registry the status
* route lives in. Only GET/HEAD exact routes exist on the shared /api channel, so the
* toggle is a GET with query parameters; the connection plugin's /api handler applies its
* trust and browser-authentication fence before dispatch, exactly as for the status read.
* (The alternatives are dead ends: `rpc.handle()` mounts a physical route through
* `owner.webServer.register()` from the caller's fiber and fails under cordis inject
* isolation, and `rpc.intercept('/api')` occupies the single interceptor slot that
* dsh-api-gateway owns - registering it replaces the gateway's dispatcher and 404s the
* entire client API.)
*
* SECURITY: the request carries a filesystem path, and the handler writes
* `<root>/.zvec-grep/config.json`. The root is therefore validated against the canonicalized
* cwd list of the sessions this Harness process knows before anything touches the disk -
* the browser must never be able to write a config file to an arbitrary path.
*/
function registerToggleRoute(fetchRegistry, deps) {
	const route = {
		path: TOGGLE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: async (request) => {
			const url = new URL(request.url);
			const enabledRaw = url.searchParams.get("enabled");
			const result = await applyToggle(deps, {
				root: url.searchParams.get("root") ?? void 0,
				enabled: enabledRaw === "true" || enabledRaw === "false" ? enabledRaw === "true" : void 0
			});
			return Response.json({ result });
		}
	};
	return fetchRegistry.register(route);
}

//#endregion
//#region src/scope-route.ts
/** Exact Fetch route the settings page uses to read and write a workspace's index scope. */
const SCOPE_PATH = "/api/dsh-zvec-grep/scope";
function resolveRoot(deps, rawRoot) {
	if (typeof rawRoot !== "string" || rawRoot.length === 0) return {
		ok: false,
		code: "bad_request",
		message: "Scope requires a non-empty root parameter"
	};
	const root = canonicalizeRoot(rawRoot);
	if (!new Set(deps.sessions.list().map((item) => item.header.cwd).filter((cwd) => typeof cwd === "string" && cwd.length > 0).map(canonicalizeRoot)).has(root)) return {
		ok: false,
		code: "not_found",
		message: `Workspace is not known to this Harness process: ${root}`
	};
	return {
		ok: true,
		root
	};
}
/**
* GET without a `scope` parameter reads the persisted scope; GET with one writes it.
* A scope document with no valid field clears the scope entirely, which the settings
* page uses as its "reset to defaults" action. Writing queues a reconcile (rescan
* without re-embedding) so the change takes effect on the next index pass.
*/
async function applyScope(deps, url) {
	const root = resolveRoot(deps, url.searchParams.get("root") ?? void 0);
	if (!root.ok) return {
		ok: false,
		error: {
			code: root.code,
			message: root.message,
			details: {}
		}
	};
	const raw = url.searchParams.get("scope");
	if (raw === null) return {
		ok: true,
		value: {
			root: root.root,
			scope: readWorkspaceConfig(root.root)?.scope ?? null
		}
	};
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			error: {
				code: "bad_request",
				message: "Scope is not valid JSON",
				details: {}
			}
		};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {
		ok: false,
		error: {
			code: "bad_request",
			message: "Scope must be a JSON object",
			details: {}
		}
	};
	const scope = sanitizeScope(parsed);
	const next = updateWorkspaceConfig(root.root, { scope });
	deps.runtime.reconcile(root.root);
	return {
		ok: true,
		value: {
			root: root.root,
			scope: next.scope ?? null
		}
	};
}
function registerScopeRoute(fetchRegistry, deps) {
	const route = {
		path: SCOPE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: async (request) => Response.json({ result: await applyScope(deps, new URL(request.url)) })
	};
	return fetchRegistry.register(route);
}

//#endregion
//#region src/index.ts
const name = "dsh-zvec-grep";
const inject = [
	"sessions",
	"tools",
	"systemPrompt"
];
const Config = z.object({
	engineModule: z.string().default(DEFAULT_ENGINE_MODULE),
	embedding: z.string().default("local/potion-code-16m-v2"),
	device: z.union([
		"auto",
		"cpu",
		"metal",
		"vulkan",
		"cuda"
	]).default("auto"),
	excludePaths: z.array(z.string()).default([]),
	defaultEnabled: z.boolean().default(false),
	defaultLimit: z.number().step(1).min(1).max(30).default(10),
	maxLimit: z.number().step(1).min(1).max(100).default(30),
	watchDebounceMs: z.number().step(1).min(50).max(3e4).default(750),
	reconcileIntervalMs: z.number().step(1).min(0).max(864e5).default(36e5),
	statusPollIntervalMs: z.number().step(1).min(250).max(6e4).default(2e3)
});
function activate(runtime, ctx, root) {
	if (!root) return;
	runtime.activate(root).catch((error) => {
		ctx.logger.warn(`dsh-zvec-grep: automatic indexing failed for ${root}: ${String(error)}`);
	});
}
function mountPlugin(ctx, runtime, config, isEnabled) {
	ctx.systemPrompt.section({
		name: "tool:zvec-search",
		order: 103,
		text: "Use zvec_search for semantic or cross-file workspace discovery when wording or location is unknown. Use exact grep for known identifiers, literals, regular expressions, or exhaustive occurrence lists. Use zvec_manage to enable, rescan, or scope the workspace index when the user asks for it."
	});
	ctx.tools.register(createSearchTool(runtime, config));
	ctx.tools.register(createManageTool({
		runtime,
		isEnabled
	}));
	ctx.on("session/created", (session) => {
		activate(runtime, ctx, session.header.cwd);
	}, { global: true });
	for (const session of ctx.sessions.list()) activate(runtime, ctx, session.header.cwd);
	ctx.effect(() => () => runtime.close());
}
function apply(ctx, config) {
	if ((config.defaultLimit ?? 10) > (config.maxLimit ?? 30)) throw new Error("dsh-zvec-grep: defaultLimit cannot exceed maxLimit");
	const embedding = config.embedding ?? "local/potion-code-16m-v2";
	const device = config.device ?? "auto";
	const engines = new EngineLoader({
		specifier: config.engineModule ?? DEFAULT_ENGINE_MODULE,
		onWarning: (message) => ctx.logger.warn(message)
	});
	const isEnabled = (root) => resolveEnabled(root, config.defaultEnabled ?? false);
	const runtime = new WorkspaceSearchRuntime({
		create: async (root) => (await engines.load()).createZvecGrep({
			root,
			embedding,
			device
		}),
		watch: createWorkspaceWatcher,
		debounceMs: config.watchDebounceMs ?? 750,
		reconcileIntervalMs: config.reconcileIntervalMs ?? 36e5,
		excludePaths: config.excludePaths ?? [],
		scope: (root) => readWorkspaceConfig(root)?.scope,
		enabled: isEnabled
	});
	mountPlugin(ctx, runtime, {
		defaultLimit: config.defaultLimit ?? 10,
		maxLimit: config.maxLimit ?? 30
	}, isEnabled);
	const statusFiber = ctx.inject(["connection"], (childCtx) => {
		childCtx.effect(() => registerStatusRoute(childCtx.connection.fetch, runtime, childCtx.sessions, config.statusPollIntervalMs ?? 2e3, isEnabled, () => engines.load().then(() => ({ available: true }), (error) => ({
			available: false,
			detail: error instanceof Error ? error.message : String(error)
		}))), "dsh-zvec-grep: status route");
	});
	const toggleFiber = ctx.inject(["connection"], (childCtx) => {
		childCtx.effect(() => {
			try {
				return registerToggleRoute(childCtx.connection.fetch, {
					runtime,
					sessions: childCtx.sessions
				});
			} catch (error) {
				console.warn("[dsh-zvec-grep] workspace toggle route unavailable, enable/disable falls back to editing .zvec-grep/config.json:", error);
				return () => {};
			}
		}, "dsh-zvec-grep: workspace toggle route");
	});
	const scopeFiber = ctx.inject(["connection"], (childCtx) => {
		childCtx.effect(() => {
			try {
				return registerScopeRoute(childCtx.connection.fetch, {
					runtime,
					sessions: childCtx.sessions
				});
			} catch (error) {
				console.warn("[dsh-zvec-grep] workspace scope route unavailable, scope editing falls back to editing .zvec-grep/config.json:", error);
				return () => {};
			}
		}, "dsh-zvec-grep: workspace scope route");
	});
	const settingsFiber = ctx.inject(["settings"], (childCtx) => {
		childCtx.effect(() => {
			try {
				childCtx.settings.register("zvec-grep", z.object({}));
			} catch (error) {
				console.warn("[dsh-zvec-grep] settings namespace unavailable, the settings card will not appear:", error);
			}
			return () => {};
		}, "dsh-zvec-grep: settings namespace");
	});
	ctx.effect(() => () => {
		statusFiber.dispose();
		toggleFiber.dispose();
		scopeFiber.dispose();
		settingsFiber.dispose();
	}, "dsh-zvec-grep: optional web status");
}

//#endregion
export { Config, apply, inject, mountPlugin, name };