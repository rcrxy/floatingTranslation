import * as vscode from "vscode";
import { AliyunTranslation } from "./modules/aliyun";
import {BaiduTranslation} from "./modules/baidu";
import { ConfigTool } from "./Utils/ConfigTool";
import { output } from "./Utils/output";
import { restoreTranslationPlaceholders, type TranslatableContent } from "./Utils/TranslatableContentAnalyzer";

/** 不关心具体服务实现的批量文本翻译函数。 */
type TranslationInvoker = (sourceTexts: readonly string[]) => Promise<string[]>;

type TranslationPlanPart =
   | {
        readonly kind: "literal";
        readonly text: string;
     }
   | {
        readonly kind: "translated";
        readonly translationIndex: number;
     };

type TranslationPlan = {
   readonly parts: readonly TranslationPlanPart[];
};

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
         return translateContents(contents, (sourceTexts) => aliyun.invoke(sourceTexts));
      }
      case "baidu": {
         const baidu = new BaiduTranslation({
            sourceLanguage,
            targetLanguage,
            appId: configuration.apiKey,
            appKey: configuration.secretKey,
         });
         return translateContents(contents, (sourceTexts) => baidu.invoke(sourceTexts));
      }
      default:
         throw new Error(`不支持的翻译工具：${configuration.translationTool}`);
   }
}

/** 按原顺序翻译片段，并把不可翻译内容和 Markdown 占位符还原到结果中。 */
export async function translateContents(
   contents: readonly TranslatableContent[],
   translate: TranslationInvoker,
): Promise<string> {
   const sourceTexts: string[] = [];
   const translationPlans = contents.flatMap((content) =>
      content.value
         .filter((value) => value.isTranslatable)
         .map((value) => createTranslationPlan(value.text, value.placeholders, sourceTexts)),
   );

   if (sourceTexts.length === 0) {
      // 防止把完全没有自然语言的 Hover 误报为翻译成功。
      throw new Error("没有可翻译的内容");
   }

   const translatedTexts = await translate(sourceTexts);

   if (translatedTexts.length !== sourceTexts.length) {
      throw new Error("翻译服务返回的译文数量与原文数量不一致");
   }

   const translatedContents: string[] = [];
   let translatedValueIndex = 0;

   output.appendLine(`---------- 占位符还原前译文 ---------- \n`);
   for (const content of contents) {
      const translatedValues: string[] = [];

      for (const value of content.value) {
         if (!value.isTranslatable) {
            // 代码围栏等字面内容不发送到第三方服务，但保留在最终 Hover 中。
            translatedValues.push(value.text);
            continue;
         }

         const translatedText = restoreTranslationPlan(translationPlans[translatedValueIndex], translatedTexts);

         output.appendLine(`${translatedText}\n`); // 打印替换前的内容

         // 翻译服务只接触占位符，最终展示前恢复原始 Markdown 和标识符。
         translatedValues.push(restoreTranslationPlaceholders(value.text, translatedText, value.placeholders));
         translatedValueIndex += 1;
      }

      if (translatedValues.length > 0) {
         translatedContents.push(translatedValues.join("\n\n"));
      }
   }

   return translatedContents.join("\n\n");
}

/**
 * 将占位符保留为本地字面片段，只登记占位符之间真正需要翻译的文本。
 * 翻译服务从未接触 token，因此无法插入空格、删除括号或修改其中的数字。
 */
function createTranslationPlan(
   sourceText: string,
   placeholders: TranslatableContent["value"][number]["placeholders"],
   sourceTexts: string[],
): TranslationPlan {
   const parts: TranslationPlanPart[] = [];
   const positionedPlaceholders = placeholders
      .map((placeholder) => ({placeholder, index: sourceText.indexOf(placeholder.token)}))
      .filter((item) => item.index >= 0)
      .sort((left, right) => left.index - right.index);
   let sourceIndex = 0;

   const appendText = (text: string): void => {
      const trimmedText = text.trim();

      if (!trimmedText || !/\p{L}/u.test(trimmedText)) {
         parts.push({kind: "literal", text});
         return;
      }

      const trimmedTextIndex = text.indexOf(trimmedText);
      const leadingText = text.slice(0, trimmedTextIndex);
      const trailingText = text.slice(trimmedTextIndex + trimmedText.length);

      if (leadingText) {
         parts.push({kind: "literal", text: leadingText});
      }

      parts.push({kind: "translated", translationIndex: sourceTexts.push(trimmedText) - 1});

      if (trailingText) {
         parts.push({kind: "literal", text: trailingText});
      }
   };

   for (const {placeholder, index} of positionedPlaceholders) {
      appendText(sourceText.slice(sourceIndex, index));
      parts.push({kind: "literal", text: placeholder.token});
      sourceIndex = index + placeholder.token.length;
   }

   appendText(sourceText.slice(sourceIndex));

   return {parts};
}

/** 按翻译计划合并平台返回的自然语言片段和本地保存的精确占位符。 */
function restoreTranslationPlan(plan: TranslationPlan, translatedTexts: readonly string[]): string {
   return plan.parts
      .map((part) => (part.kind === "literal" ? part.text : translatedTexts[part.translationIndex]))
      .join("");
}
