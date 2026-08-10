import * as vscode from "vscode";
import { AliyunTranslation } from "./modules/aliyun";
import { ConfigTool } from "./Utils/ConfigTool";
import { output } from "./Utils/output";
import { restoreTranslationPlaceholders, type TranslatableContent } from "./Utils/TranslatableContentAnalyzer";

/** 不关心具体服务实现的单段文本翻译函数。 */
type TranslationInvoker = (sourceText: string) => Promise<string>;

/**
 * 根据当前配置创建翻译服务，并翻译分析器输出的全部内容。
 * 服务所需配置在这里注入，底层模块不直接依赖 VS Code 配置 API。
 */
export async function AggregationTranslation(
   contents: readonly TranslatableContent[],
   configTool: ConfigTool,
): Promise<string> {
   const configuration = await configTool.getAll();
   // 空源语言交给服务自动识别；空目标语言跟随 VS Code 当前显示语言。
   const sourceLanguage = configuration.sourceLanguage || "auto";
   const targetLanguage = configuration.targetLanguage || vscode.env.language;

   switch (configuration.translationTool) {
      case "aliyun": {
         const aliyun = new AliyunTranslation({
            sourceLanguage,
            targetLanguage,
            accessKeyId: configuration.apiKey,
            accessKeySecret: configuration.secretKey,
         });
         return translateContents(contents, (sourceText) => aliyun.invoke(sourceText));
      }
      default:
         throw new Error(`不支持的翻译工具：${configuration.translationTool}`);
   }
}

/** 按原顺序翻译片段，并把不可翻译内容和 Markdown 占位符还原到结果中。 */
async function translateContents(contents: readonly TranslatableContent[], translate: TranslationInvoker): Promise<string> {
   const translatedContents: string[] = [];
   let translatedValueCount = 0;

   for (const content of contents) {
      const translatedValues: string[] = [];

      // 保持串行调用，确保结果顺序稳定并避免同时消耗服务端配额。
      for (const value of content.value) {
         if (!value.isTranslatable) {
            // 代码围栏等字面内容不发送到第三方服务，但保留在最终 Hover 中。
            translatedValues.push(value.text);
            continue;
         }

         const translatedText = await translate(value.text);

         output.appendLine(`占位符还原前译文：\n${translatedText}`);

         // 翻译服务只接触占位符，最终展示前恢复原始 Markdown 和标识符。
         translatedValues.push(restoreTranslationPlaceholders(value.text, translatedText, value.placeholders));
         translatedValueCount += 1;
      }

      if (translatedValues.length > 0) {
         translatedContents.push(translatedValues.join("\n\n"));
      }
   }

   if (translatedValueCount === 0) {
      // 防止把完全没有自然语言的 Hover 误报为翻译成功。
      throw new Error("没有可翻译的内容");
   }

   return translatedContents.join("\n\n");
}
