/** 一次 Hover 分析的汇总结果。 */
export interface TranslatableContentResult {
   /** 基于原始 Hover 内容生成的稳定摘要。 */
   readonly key: string;
   /** 按原始 Hover 顺序保存的结构化内容。 */
   readonly contents: readonly TranslatableContent[];
}

/** 单个 Hover 的原文及其拆分结果。 */
export interface TranslatableContent {
   /** 按展示顺序排列的可翻译片段和字面片段。 */
   readonly value: readonly TranslatableContentValue[];
   /** 未经拆分和占位符替换的完整 Markdown。 */
   readonly sourceText: string;
}

/** 可单独处理的一段 Hover 内容。 */
export interface TranslatableContentValue {
   /** 可翻译文本，或应原样保留的字面文本。 */
   readonly text: string;
   /** true 表示 text 可以发送到翻译服务。 */
   readonly isTranslatable: boolean;
   /** 翻译后需要恢复到 text 中的 Markdown 或代码片段。 */
   readonly placeholders: readonly TranslationPlaceholder[];
}

/** 翻译前临时替换受保护内容的占位符。 */
export interface TranslationPlaceholder {
   /** 唯一临时标记；是否发送给翻译服务由当前翻译尺度决定。 */
   readonly token: string;
   /** 完成翻译后需要原样恢复的内容。 */
   readonly source: string;
}
