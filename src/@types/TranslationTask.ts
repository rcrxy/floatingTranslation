/** 不关心具体服务实现的批量文本翻译函数。 */
export type TranslationInvoker = (sourceTexts: readonly string[]) => Promise<string[]>;

/** 上层可等待或终止的一次完整翻译任务。 */
export interface TranslationTask {
   readonly promise: Promise<string>;
   readonly terminate: () => void;
}
