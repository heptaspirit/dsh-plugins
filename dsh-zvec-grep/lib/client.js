window.__ModuleLoader__.load({ id: "@sugarforever/dsh-zvec-grep", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/client/IndexStatusPill.tsx
const labels = {
	indexing: "Indexing",
	refreshing: "Refreshing",
	ready: "Ready",
	error: "Error",
	disabled: "Off"
};
const colors = {
	indexing: "var(--dsw-alias-state-warn-primary)",
	refreshing: "var(--dsw-alias-brand-primary)",
	ready: "var(--dsw-alias-state-success-primary)",
	error: "var(--dsw-alias-state-error-primary)",
	disabled: "var(--dsw-alias-label-secondary)"
};
function displayStatus(feed) {
	if (feed.connection === "error") return {
		status: "error",
		pendingChanges: 0,
		updatedAt: 0,
		errorCode: "index_failed"
	};
	return feed.status;
}
/**
* Read-only status surface. Enablement and scope live in the settings page's Zvec Search
* section, where the full workspace list fits; the pill only reports the current phase.
*/
function IndexStatusPill(props) {
	const [expanded, setExpanded] = (0, react.useState)(false);
	const root = props.useSessions((state) => {
		const current = state.current;
		return current === void 0 ? void 0 : state.byId[current]?.cwd;
	});
	const feed = props.useIndexStatus((value) => value);
	(0, react.useEffect)(() => {
		props.statusSource.selectWorkspace(root);
	}, [props.statusSource, root]);
	if (root === void 0) return null;
	const status = displayStatus(feed);
	const phase = status?.status ?? "indexing";
	const label = status === void 0 && feed.connection === "loading" ? "Loading" : labels[phase];
	const reason = feed.connection === "error" ? feed.message : void 0;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: styles.anchor,
		"data-zvec-index-status": phase,
		children: [expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: styles.panel,
			role: "status",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					style: styles.heading,
					children: "Zvec index"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.path,
					children: root
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["Status: ", label] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["Pending changes: ", status?.pendingChanges ?? 0] }),
				status?.errorCode && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.error,
					children: feed.connection === "error" ? "Status unavailable" : "Index update failed"
				}),
				reason !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.error,
					children: reason
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.hint,
					children: "Enable, disable, and scope: Settings → Zvec Search"
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			"aria-expanded": expanded,
			"aria-label": `Zvec index ${label}`,
			title: reason === void 0 ? `Zvec index: ${label}` : `Zvec index: ${label} — ${reason}`,
			style: styles.button,
			onClick: () => setExpanded((value) => !value),
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					style: {
						...styles.dot,
						background: colors[phase]
					}
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Zvec" }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.phase,
					children: label
				})
			]
		})]
	});
}
const styles = {
	anchor: {
		position: "absolute",
		right: 16,
		bottom: 16,
		display: "flex",
		alignItems: "flex-end",
		flexDirection: "column",
		gap: 8,
		font: "500 12px/1.4 system-ui, sans-serif",
		color: "var(--dsw-alias-label-primary)",
		pointerEvents: "auto"
	},
	button: {
		display: "flex",
		alignItems: "center",
		gap: 7,
		minHeight: 32,
		padding: "6px 11px",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 999,
		color: "var(--dsw-alias-label-primary)",
		background: "var(--dsw-alias-button-floating-fill)",
		boxShadow: "0 6px 20px color-mix(in srgb, black 14%, transparent)",
		cursor: "pointer"
	},
	dot: {
		width: 8,
		height: 8,
		borderRadius: "50%"
	},
	phase: { color: "var(--dsw-alias-label-secondary)" },
	panel: {
		display: "flex",
		flexDirection: "column",
		gap: 5,
		width: 280,
		padding: 12,
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 12,
		background: "var(--dsw-alias-bg-layer-2)",
		boxShadow: "0 12px 32px color-mix(in srgb, black 18%, transparent)"
	},
	heading: { fontSize: 13 },
	path: {
		overflow: "hidden",
		color: "var(--dsw-alias-label-secondary)",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	},
	error: {
		color: "var(--dsw-alias-state-error-primary)",
		overflowWrap: "anywhere"
	},
	hint: {
		color: "var(--dsw-alias-label-secondary)",
		fontSize: 11
	}
};

//#endregion
//#region src/client/status-source.ts
const STATUS_PATH = "/api/dsh-zvec-grep/status";
const TOGGLE_PATH = "/api/dsh-zvec-grep/toggle-workspace";
const SCOPE_PATH = "/api/dsh-zvec-grep/scope";
const ERROR_RETRY_MS = 5e3;
const MISSING_WORKSPACE_RETRY_MS = 250;
const INITIAL_SNAPSHOT = Object.freeze({ connection: "loading" });
function parseWorkspace(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const item = value;
	if (typeof item.root !== "string" || item.root.length === 0 || ![
		"indexing",
		"refreshing",
		"ready",
		"error",
		"disabled"
	].includes(String(item.status)) || typeof item.pendingChanges !== "number" || typeof item.updatedAt !== "number") return void 0;
	return Object.freeze({
		root: item.root,
		status: item.status,
		pendingChanges: item.pendingChanges,
		updatedAt: item.updatedAt,
		...item.errorCode === "index_failed" ? { errorCode: "index_failed" } : {},
		...typeof item.enabled === "boolean" ? { enabled: item.enabled } : {},
		...item.scope === null || typeof item.scope === "object" && !Array.isArray(item.scope) ? { scope: item.scope } : {}
	});
}
function parsePayload(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid zvec status response");
	const payload = value;
	if (payload.version !== 4 || typeof payload.pollIntervalMs !== "number" || !Array.isArray(payload.workspaces)) throw new Error("Invalid zvec status response");
	const workspaces = payload.workspaces.map(parseWorkspace);
	if (workspaces.some((item) => item === void 0)) throw new Error("Invalid zvec workspace status");
	return {
		pollIntervalMs: payload.pollIntervalMs,
		workspaces
	};
}
var IndexStatusSource = class {
	snapshot = INITIAL_SNAPSHOT;
	listeners = /* @__PURE__ */ new Set();
	timer;
	running = false;
	root;
	generation = 0;
	constructor(fetchStatus = () => fetch(STATUS_PATH, { cache: "no-store" })) {
		this.fetchStatus = fetchStatus;
	}
	getSnapshot = () => this.snapshot;
	subscribe = (listener) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	selectWorkspace(root) {
		if (this.root === root) return;
		const hadRoot = this.root !== void 0;
		this.root = root;
		this.generation += 1;
		if (this.timer) clearTimeout(this.timer);
		this.timer = void 0;
		if (hadRoot || this.snapshot !== INITIAL_SNAPSHOT) this.publish(INITIAL_SNAPSHOT);
		if (this.running && root !== void 0) this.poll();
	}
	start() {
		if (this.running) return;
		this.running = true;
		this.poll();
	}
	stop() {
		this.running = false;
		this.generation += 1;
		if (this.timer) clearTimeout(this.timer);
		this.timer = void 0;
	}
	/** Forces an immediate poll, e.g. after a toggle so the pill reflects the new state at once. */
	refresh() {
		if (!this.running) return;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = void 0;
		}
		this.poll();
	}
	async poll() {
		const root = this.root;
		if (root === void 0) return;
		const generation = this.generation;
		let nextDelay = ERROR_RETRY_MS;
		try {
			const response = await this.fetchStatus();
			if (response.status === 404) {
				nextDelay = MISSING_WORKSPACE_RETRY_MS;
				if (this.running && this.generation === generation) this.publish(INITIAL_SNAPSHOT);
			} else {
				if (!response.ok) throw new Error(`Zvec status request failed (${response.status}) for GET ${STATUS_PATH}`);
				const payload = parsePayload(await response.json());
				const status = payload.workspaces.find((item) => item.root === root);
				nextDelay = status === void 0 ? MISSING_WORKSPACE_RETRY_MS : Math.max(250, payload.pollIntervalMs);
				if (this.running && this.generation === generation) this.publish(status === void 0 ? INITIAL_SNAPSHOT : Object.freeze({
					connection: "ready",
					status
				}));
			}
		} catch (error) {
			if (this.running && this.generation === generation) this.publish(Object.freeze({
				connection: "error",
				...this.snapshot.status === void 0 ? {} : { status: this.snapshot.status },
				message: error instanceof Error ? error.message : String(error)
			}));
		}
		if (this.running && this.generation === generation) {
			this.timer = setTimeout(() => {
				this.poll();
			}, nextDelay);
			this.timer.unref?.();
		}
	}
	publish(snapshot) {
		this.snapshot = snapshot;
		for (const listener of this.listeners) try {
			listener();
		} catch {}
	}
};
/** Unwraps the `{ result: { ok, value | error } }` envelope every exact route answers with. */
async function unwrapRoute(response, what) {
	if (!response.ok) return {
		ok: false,
		message: `${what} request failed (${response.status})`
	};
	let envelope;
	try {
		envelope = await response.json();
	} catch {
		return {
			ok: false,
			message: `${what} response was not JSON`
		};
	}
	const result = typeof envelope === "object" && envelope !== null && !Array.isArray(envelope) ? envelope["result"] : void 0;
	if (typeof result !== "object" || result === null || typeof result.ok !== "boolean") return {
		ok: false,
		message: `Malformed ${what.toLowerCase()} response`
	};
	if (result.ok) return {
		ok: true,
		value: result.value
	};
	return {
		ok: false,
		message: result.error?.message ?? `${what} failed`
	};
}
/**
* Toggles one workspace through the plugin's exact Fetch route on the shared /api channel.
* Exact routes only accept GET/HEAD, so the toggle is a GET with query parameters; browser
* authentication and the origin fence apply like on every /api request.
*/
async function requestWorkspaceToggle(root, enabled) {
	let response;
	try {
		const url = `${TOGGLE_PATH}?root=${encodeURIComponent(root)}&enabled=${enabled}`;
		response = await fetch(url);
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		};
	}
	return unwrapRoute(response, "Toggle");
}
/**
* Saves one workspace's index scope as a JSON document. An empty object (`{}`) clears the
* scope, falling the workspace back to the plugin-global defaults; any invalid field inside
* the document is dropped server-side.
*/
async function requestScopeSave(root, scopeJson) {
	let response;
	try {
		const url = `${SCOPE_PATH}?root=${encodeURIComponent(root)}&scope=${encodeURIComponent(scopeJson)}`;
		response = await fetch(url);
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		};
	}
	return unwrapRoute(response, "Scope");
}

//#endregion
//#region src/client/locales.ts
/** Localized copy for the settings card, keyed for the `zvec-grep` locale namespace. */
const LOCALE_ZH = {
	"card.title": "Zvec Search",
	"card.desc": "索引开关与排除目录（按工作区）",
	"card.expand": "展开",
	"card.collapse": "收起",
	"workspace.label": "工作区",
	"index.label": "索引此工作区",
	"index.on": "已开启",
	"index.off": "已关闭",
	"index.busy": "处理中…",
	"phase.indexing": "索引中",
	"phase.refreshing": "更新中",
	"phase.ready": "就绪",
	"phase.error": "出错",
	"phase.disabled": "已关闭",
	"excludes.label": "排除的目录（保存后下次扫描起不再索引；嵌套路径请写前缀，如 src/vendor/**）",
	"excludes.placeholder": "例如 dist",
	"excludes.add": "添加",
	"excludes.remove": "移除",
	"invalid.empty": "路径不能为空",
	"invalid.whitespace": "路径不能包含空格或换行",
	"invalid.duplicate": "该条目已存在",
	"advanced.none": "高级字段：未设置（globs、fileTypes、maxDepth 等，需要时让 agent 用 zvec_manage 配置）",
	"advanced.prefix": "高级字段：",
	"advanced.suffix": "（让 agent 用 zvec_manage 修改）",
	"engine.missing": "搜索引擎 @zvec/zvec-grep 未安装：请在终端运行 npm install -g @zvec/zvec-grep，然后重启 DSH。",
	"load.unavailable": "Zvec 索引设置不可用",
	"load.loading": "正在加载…",
	"load.empty": "还没有已知的工作区。先在某个项目文件夹里开一个会话。",
	"error.fallback": "操作失败"
};
const LOCALE_EN = {
	"card.title": "Zvec Search",
	"card.desc": "Indexing switches and excluded directories, per workspace",
	"card.expand": "Expand",
	"card.collapse": "Collapse",
	"workspace.label": "Workspace",
	"index.label": "Index this workspace",
	"index.on": "On",
	"index.off": "Off",
	"index.busy": "Working…",
	"phase.indexing": "Indexing",
	"phase.refreshing": "Refreshing",
	"phase.ready": "Ready",
	"phase.error": "Error",
	"phase.disabled": "Off",
	"excludes.label": "Excluded directories (applied from the next scan; nested paths need a prefix glob like src/vendor/**)",
	"excludes.placeholder": "e.g. dist",
	"excludes.add": "Add",
	"excludes.remove": "Remove",
	"invalid.empty": "The path must not be empty",
	"invalid.whitespace": "The path must not contain spaces or line breaks",
	"invalid.duplicate": "This entry already exists",
	"advanced.none": "Advanced fields: none set (globs, fileTypes, maxDepth, ... — have the agent configure them with zvec_manage)",
	"advanced.prefix": "Advanced fields: ",
	"advanced.suffix": " (have the agent change them with zvec_manage)",
	"engine.missing": "The @zvec/zvec-grep engine is not installed: run npm install -g @zvec/zvec-grep in a terminal, then restart DSH.",
	"load.unavailable": "Zvec index settings unavailable",
	"load.loading": "Loading…",
	"load.empty": "No known workspaces yet. Open a conversation in a project folder first.",
	"error.fallback": "The action failed"
};

//#endregion
//#region src/client/settings.tsx
/**
* Visual language of the settings page's configurable-plugin cards (same class names and
* rules the established cards render with), injected once by this bundle.
*/
const SETTINGS_CSS = [
	".lc-settings-card{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);transition:border-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out), background-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out);border-radius:12px}",
	".lc-settings-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
	".lc-settings-open,.lc-settings-open:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
	".lc-settings-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
	".lc-settings-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
	".lc-settings-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
	".lc-settings-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
	".lc-settings-chevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out);flex:none}",
	".lc-settings-open .lc-settings-chevron{transform:rotate(180deg)}",
	".lc-settings-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:4px 0 12px}",
	".lc-settings-row{align-items:center;gap:8px;padding:8px 0;display:flex}",
	".lc-settings-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:14px}",
	".lc-settings-select{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out);border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}",
	".lc-settings-note{color:var(--dsw-alias-label-tertiary);margin:12px 0 4px;font-size:12px;line-height:1.5}",
	".zvec-chiprow{display:flex;flex-wrap:wrap;gap:6px;padding:8px 0}",
	".zvec-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-module-platform);font-size:12px}",
	".zvec-chip>button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1;padding:0 2px}",
	".zvec-input{flex:1;height:36px;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:18px;padding:0 14px;font:inherit;color:var(--dsw-alias-label-primary);font-size:14px}",
	".zvec-btn{height:36px;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:18px;padding:0 14px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:14px}",
	".zvec-btn-primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-on-primary,#fff)}",
	".zvec-error{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}",
	".zvec-phase{color:var(--dsw-alias-label-tertiary);font-size:13px;display:inline-flex;align-items:center;gap:6px}",
	".zvec-dot{width:8px;height:8px;border-radius:50%;flex:none}",
	".zvec-dot-indexing{background:var(--dsw-alias-state-warn-primary)}",
	".zvec-dot-refreshing{background:var(--dsw-alias-brand-primary)}",
	".zvec-dot-ready{background:var(--dsw-alias-state-success-primary)}",
	".zvec-dot-error{background:var(--dsw-alias-state-error-primary)}",
	".zvec-dot-disabled{background:var(--dsw-alias-label-secondary)}",
	".zvec-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}"
].join("\n");
function ensureSettingsStyles() {
	if (typeof document === "undefined") return;
	if (document.querySelector("style[data-plugin-css=\"dsh-zvec-grep/settings.css\"]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.pluginCss = "dsh-zvec-grep/settings.css";
	tag.textContent = SETTINGS_CSS;
	document.head.appendChild(tag);
}
/** Returns an error message key when the entry must not be saved, undefined when it is fine. */
function validateExclude(current, rawValue) {
	const value = rawValue.trim();
	if (value.length === 0) return "invalid.empty";
	if (/\s/.test(value)) return "invalid.whitespace";
	if (current.includes(value)) return "invalid.duplicate";
}
function scopeExcludes(scope) {
	const raw = scope?.excludePaths;
	return Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
}
/** One-line summary of the advanced scope fields the UI deliberately does not edit. */
function advancedSummary(t, scope) {
	const entries = Object.entries(scope ?? {}).filter(([key]) => key !== "excludePaths");
	if (entries.length === 0) return t("advanced.none");
	return `${t("advanced.prefix")}${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ")}${t("advanced.suffix")}`;
}
/**
* The "Zvec Search" card of the settings Plugins page, dispatched per settings namespace.
* One collapsible card in the shared settings-card visual language; a selector switches
* between workspaces so the card stays one detail panel tall no matter how many exist. It
* manages the two scope knobs shaped for direct manipulation - the indexing switch and
* excluded directories - while advanced fields are shown read-only and stay hand-written
* through the agent's zvec_manage tool on purpose.
*/
function WorkspaceSettings(props) {
	const { t } = props;
	const [workspaces, setWorkspaces] = (0, react.useState)();
	const [loadError, setLoadError] = (0, react.useState)();
	const [busy, setBusy] = (0, react.useState)();
	const [actionError, setActionError] = (0, react.useState)({});
	const [draftPath, setDraftPath] = (0, react.useState)({});
	const [inputError, setInputError] = (0, react.useState)({});
	const [cardOpen, setCardOpen] = (0, react.useState)(false);
	const [selectedRoot, setSelectedRoot] = (0, react.useState)();
	const [engineStatus, setEngineStatus] = (0, react.useState)();
	const load = (0, react.useCallback)(async () => {
		try {
			const response = await fetch("/api/dsh-zvec-grep/status", { cache: "no-store" });
			if (!response.ok) throw new Error(`${response.status}`);
			const payload = await response.json();
			const list = payload.workspaces;
			if (!Array.isArray(list)) throw new Error("malformed");
			setWorkspaces(list);
			setLoadError(void 0);
			setSelectedRoot((current) => list.some((item) => item.root === current) ? current : list[0]?.root);
			setEngineStatus(payload.engine === void 0 ? void 0 : {
				available: payload.engine.available === true,
				detail: payload.engine.detail
			});
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error));
		}
	}, []);
	(0, react.useEffect)(() => {
		load();
	}, [load]);
	const run = async (root, action) => {
		if (busy !== void 0) return;
		setBusy(root);
		setActionError((current) => ({
			...current,
			[root]: void 0
		}));
		const outcome = await action();
		setBusy(void 0);
		if (!outcome.ok) {
			setActionError((current) => ({
				...current,
				[root]: outcome.message ?? t("error.fallback")
			}));
			return;
		}
		load();
	};
	const toggle = (root, enabled) => {
		run(root, () => requestWorkspaceToggle(root, enabled));
	};
	/** Saves `{...scope, excludePaths}`; an empty list removes the key instead of writing []. */
	const saveExcludes = async (workspace, excludes) => {
		const doc = { ...workspace.scope ?? {} };
		if (excludes.length > 0) doc.excludePaths = excludes;
		else delete doc.excludePaths;
		await run(workspace.root, () => requestScopeSave(workspace.root, JSON.stringify(doc)));
	};
	const addExclude = (workspace) => {
		const root = workspace.root;
		const excludes = scopeExcludes(workspace.scope);
		const draft = draftPath[root] ?? "";
		const problem = validateExclude(excludes, draft);
		if (problem !== void 0) {
			setInputError((current) => ({
				...current,
				[root]: problem
			}));
			return;
		}
		setInputError((current) => ({
			...current,
			[root]: void 0
		}));
		setDraftPath((current) => ({
			...current,
			[root]: ""
		}));
		saveExcludes(workspace, [...excludes, draft.trim()]);
	};
	const selected = workspaces?.find((item) => item.root === selectedRoot);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		className: `lc-settings-card${cardOpen ? " lc-settings-open" : ""}`,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: "lc-settings-head",
			"aria-expanded": cardOpen,
			"aria-label": `${t(cardOpen ? "card.collapse" : "card.expand")}: ${t("card.title")}`,
			onClick: () => setCardOpen((value) => !value),
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "lc-settings-headtext",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "lc-settings-name",
					children: t("card.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "lc-settings-desc",
					children: t("card.desc")
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "lc-settings-chevron",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					width: 14,
					height: 14,
					viewBox: "0 0 14 14",
					fill: "none",
					xmlns: "http://www.w3.org/2000/svg",
					"aria-hidden": "true",
					focusable: "false",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
						fill: "currentColor"
					})
				})
			})]
		}), cardOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "lc-settings-body",
			children: [
				engineStatus !== void 0 && engineStatus.available === false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "lc-settings-note",
					role: "status",
					title: engineStatus.detail,
					children: t("engine.missing")
				}),
				loadError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "lc-settings-note",
					role: "status",
					children: `${t("load.unavailable")}: ${loadError}`
				}),
				loadError === void 0 && workspaces === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "lc-settings-note",
					children: t("load.loading")
				}),
				loadError === void 0 && workspaces !== void 0 && workspaces.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "lc-settings-note",
					children: t("load.empty")
				}),
				selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "lc-settings-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "lc-settings-label",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: "zvec-workspace-picker",
								children: t("workspace.label")
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							id: "zvec-workspace-picker",
							className: "lc-settings-select",
							value: selected.root,
							onChange: (event) => setSelectedRoot(event.target.value),
							children: (workspaces ?? []).map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: workspace.root,
								children: `${workspace.root}（${t(`phase.${workspace.status}`)}）`
							}, workspace.root))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "lc-settings-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "lc-settings-label",
								children: t("index.label")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "switch",
								"aria-checked": selected.enabled === true,
								disabled: busy !== void 0,
								className: "lc-settings-select",
								onClick: () => toggle(selected.root, selected.enabled !== true),
								children: busy === selected.root ? t("index.busy") : selected.enabled === true ? t("index.on") : t("index.off")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "zvec-phase",
								"data-zvec-phase": selected.status,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `zvec-dot zvec-dot-${selected.status}`,
									"aria-hidden": true
								}), t(`phase.${selected.status}`)]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "lc-settings-row",
						style: {
							flexDirection: "column",
							alignItems: "stretch"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "lc-settings-label",
								children: t("excludes.label")
							}),
							scopeExcludes(selected.scope).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "zvec-chiprow",
								children: scopeExcludes(selected.scope).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "zvec-chip",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": `${t("excludes.remove")} ${item}`,
										disabled: busy !== void 0,
										onClick: () => {
											saveExcludes(selected, scopeExcludes(selected.scope).filter((entry) => entry !== item));
										},
										children: "×"
									})]
								}, item))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "lc-settings-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "text",
									value: draftPath[selected.root] ?? "",
									placeholder: t("excludes.placeholder"),
									className: "zvec-input",
									onChange: (event) => {
										const value = event.target.value;
										setDraftPath((current) => ({
											...current,
											[selected.root]: value
										}));
										if (inputError[selected.root] !== void 0) setInputError((current) => ({
											...current,
											[selected.root]: void 0
										}));
									},
									onKeyDown: (event) => {
										if (event.key === "Enter") addExclude(selected);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy !== void 0,
									className: "zvec-btn zvec-btn-primary",
									onClick: () => addExclude(selected),
									children: t("excludes.add")
								})]
							}),
							inputError[selected.root] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "zvec-error",
								children: t(inputError[selected.root])
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "zvec-hint",
								children: advancedSummary(t, selected.scope)
							}),
							actionError[selected.root] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "zvec-error",
								children: actionError[selected.root]
							})
						]
					})
				] })
			]
		})]
	});
}

//#endregion
//#region src/client/index.tsx
const inject = ["slots", "locale"];
function apply(ctx) {
	const status = new IndexStatusSource();
	ctx.effect(() => {
		status.start();
		return () => status.stop();
	}, "dsh-zvec-grep: status polling");
	ctx.slots.inject("shell.overlay", () => ctx.slots.register({
		name: "shell.overlay",
		id: "zvec-index-status",
		order: 50,
		inject: () => ({
			hooks: { indexStatus: status },
			statusSource: status
		})
	}, IndexStatusPill));
	ctx.effect(() => {
		ctx.locale.register("zvec-grep", {
			zh: LOCALE_ZH,
			en: LOCALE_EN
		});
		return () => {};
	}, "dsh-zvec-grep: card dictionaries");
	ensureSettingsStyles();
	ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
		name: "settings.plugin.item",
		key: "zvec-grep",
		locale: "zvec-grep"
	}, WorkspaceSettings));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map