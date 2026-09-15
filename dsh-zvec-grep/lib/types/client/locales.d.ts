/** Localized copy for the settings card, keyed for the `zvec-grep` locale namespace. */
export declare const LOCALE_ZH: {
    readonly 'card.title': "Zvec Search";
    readonly 'card.desc': "索引开关与排除目录（按工作区）";
    readonly 'card.expand': "展开";
    readonly 'card.collapse': "收起";
    readonly 'workspace.label': "工作区";
    readonly 'index.label': "索引此工作区";
    readonly 'index.on': "已开启";
    readonly 'index.off': "已关闭";
    readonly 'index.busy': "处理中…";
    readonly 'phase.indexing': "索引中";
    readonly 'phase.refreshing': "更新中";
    readonly 'phase.ready': "就绪";
    readonly 'phase.error': "出错";
    readonly 'phase.disabled': "已关闭";
    readonly 'excludes.label': "排除的目录（保存后下次扫描起不再索引；嵌套路径请写前缀，如 src/vendor/**）";
    readonly 'excludes.placeholder': "例如 dist";
    readonly 'excludes.add': "添加";
    readonly 'excludes.remove': "移除";
    readonly 'invalid.empty': "路径不能为空";
    readonly 'invalid.whitespace': "路径不能包含空格或换行";
    readonly 'invalid.duplicate': "该条目已存在";
    readonly 'advanced.none': "高级字段：未设置（globs、fileTypes、maxDepth 等，需要时让 agent 用 zvec_manage 配置）";
    readonly 'advanced.prefix': "高级字段：";
    readonly 'advanced.suffix': "（让 agent 用 zvec_manage 修改）";
    readonly 'engine.missing': "搜索引擎 @zvec/zvec-grep 未安装：请在终端运行 npm install -g @zvec/zvec-grep，然后重启 DSH。";
    readonly 'load.unavailable': "Zvec 索引设置不可用";
    readonly 'load.loading': "正在加载…";
    readonly 'load.empty': "还没有已知的工作区。先在某个项目文件夹里开一个会话。";
    readonly 'error.fallback': "操作失败";
};
export declare const LOCALE_EN: Record<keyof typeof LOCALE_ZH, string>;
export type ZvecLocaleKey = keyof typeof LOCALE_ZH;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'zvec-grep': ZvecLocaleKey;
    }
}
//# sourceMappingURL=locales.d.ts.map