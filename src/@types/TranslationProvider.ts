/** 聚合层调用任意翻译服务所需的公共能力。 */
export interface TranslationProvider {
   /** 用于输出通道和用户可见诊断的服务名称。 */
   readonly serviceName: string;
   /** 根据文本片段数量返回本次实际启动的并发请求数。 */
   getConcurrentRequestCount(textCount: number): number;
   /** 批量翻译非空文本，并保持返回结果与输入顺序一致。 */
   invoke(texts: readonly string[]): Promise<string[]>;
   /** 停止调度后续请求，并尽可能终止当前批次的在途请求。 */
   terminate(): void;
}
