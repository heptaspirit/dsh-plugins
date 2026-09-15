/** Localized copy for the settings card, keyed for the `zvec-grep` locale namespace. */
export const LOCALE_ZH = {
  'card.title': 'Zvec Search',
  'card.desc': '索引开关与排除目录（按工作区）',
  'card.expand': '展开',
  'card.collapse': '收起',
  'workspace.label': '工作区',
  'index.label': '索引此工作区',
  'index.on': '已开启',
  'index.off': '已关闭',
  'index.busy': '处理中…',
  'phase.indexing': '索引中',
  'phase.refreshing': '更新中',
  'phase.ready': '就绪',
  'phase.error': '出错',
  'phase.disabled': '已关闭',
  'excludes.label': '排除的目录（保存后下次扫描起不再索引；嵌套路径请写前缀，如 src/vendor/**）',
  'excludes.placeholder': '例如 dist',
  'excludes.add': '添加',
  'excludes.remove': '移除',
  'invalid.empty': '路径不能为空',
  'invalid.whitespace': '路径不能包含空格或换行',
  'invalid.duplicate': '该条目已存在',
  'advanced.none': '高级字段：未设置（globs、fileTypes、maxDepth 等，需要时让 agent 用 zvec_manage 配置）',
  'advanced.prefix': '高级字段：',
  'advanced.suffix': '（让 agent 用 zvec_manage 修改）',
  'engine.missing': '搜索引擎 @zvec/zvec-grep 未安装：请在终端运行 npm install -g @zvec/zvec-grep，然后重启 DSH。',
  'load.unavailable': 'Zvec 索引设置不可用',
  'load.loading': '正在加载…',
  'load.empty': '还没有已知的工作区。先在某个项目文件夹里开一个会话。',
  'error.fallback': '操作失败',
} as const

export const LOCALE_EN: Record<keyof typeof LOCALE_ZH, string> = {
  'card.title': 'Zvec Search',
  'card.desc': 'Indexing switches and excluded directories, per workspace',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'workspace.label': 'Workspace',
  'index.label': 'Index this workspace',
  'index.on': 'On',
  'index.off': 'Off',
  'index.busy': 'Working…',
  'phase.indexing': 'Indexing',
  'phase.refreshing': 'Refreshing',
  'phase.ready': 'Ready',
  'phase.error': 'Error',
  'phase.disabled': 'Off',
  'excludes.label': 'Excluded directories (applied from the next scan; nested paths need a prefix glob like src/vendor/**)',
  'excludes.placeholder': 'e.g. dist',
  'excludes.add': 'Add',
  'excludes.remove': 'Remove',
  'invalid.empty': 'The path must not be empty',
  'invalid.whitespace': 'The path must not contain spaces or line breaks',
  'invalid.duplicate': 'This entry already exists',
  'advanced.none': 'Advanced fields: none set (globs, fileTypes, maxDepth, ... — have the agent configure them with zvec_manage)',
  'advanced.prefix': 'Advanced fields: ',
  'advanced.suffix': ' (have the agent change them with zvec_manage)',
  'engine.missing': 'The @zvec/zvec-grep engine is not installed: run npm install -g @zvec/zvec-grep in a terminal, then restart DSH.',
  'load.unavailable': 'Zvec index settings unavailable',
  'load.loading': 'Loading…',
  'load.empty': 'No known workspaces yet. Open a conversation in a project folder first.',
  'error.fallback': 'The action failed',
}

export type ZvecLocaleKey = keyof typeof LOCALE_ZH

// The locale dictionary owners extend this table by declaration merging, exactly like SlotMap.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'zvec-grep': ZvecLocaleKey
  }
}
