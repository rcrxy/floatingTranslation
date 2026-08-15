import * as vscode from "vscode";
import { AliyunTranslation } from "./modules/aliyun";
import { BaiduTranslation } from "./modules/baidu";
import { OpenAiCompatibleTranslation } from "./modules/openaiCompatible";
import { ConfigTool, type TranslationMode } from "./Utils/ConfigTool";
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
            accessKeyId: configuration.aliyunAccessKeyId,
            accessKeySecret: configuration.aliyunAccessKeySecret,
         });
         return translateContents(contents, (sourceTexts) => aliyun.invoke(sourceTexts), configuration.translationMode);
      }
      case "baidu": {
         const baidu = new BaiduTranslation({
            sourceLanguage,
            targetLanguage,
            appId: configuration.baiduAppId,
            appKey: configuration.baiduAppKey,
         });
         return translateContents(contents, (sourceTexts) => baidu.invoke(sourceTexts), configuration.translationMode);
      }
      case "openaiCompatible": {
         const openAiCompatible = new OpenAiCompatibleTranslation({
            endpoint: configuration.openAiCompatibleEndpoint,
            apiKey: configuration.openAiCompatibleApiKey,
            model: configuration.openAiCompatibleModel,
            sourceLanguage,
            targetLanguage,
            translationMode: configuration.translationMode,
            customPrompt: configuration.customPrompt,
         });
         return translateContents(
            contents,
            (sourceTexts) => openAiCompatible.invoke(sourceTexts),
            configuration.translationMode,
         );
      }
      default:
         throw new Error(`不支持的翻译工具：${configuration.translationTool}`);
   }
}

/** 按配置的内容尺度翻译片段，并按原顺序重建最终 Markdown。 */
export async function translateContents(
   contents: readonly TranslatableContent[],
   translate: TranslationInvoker,
   mode: TranslationMode = "localPlaceholders",
): Promise<string> {
   switch (mode) {
      case "fullText":
         return translateFullText(contents, translate);
      case "codeBlocks":
         return translateWithCodeBlockProtection(contents, translate);
      case "remotePlaceholders":
         return translateWithRemotePlaceholders(contents, translate);
      case "localPlaceholders":
         return translateWithLocalPlaceholders(contents, translate);
   }
}

/** 判断指定尺度下是否至少存在一段会发送给翻译服务的内容。 */
export function hasTranslatableContent(contents: readonly TranslatableContent[], mode: TranslationMode): boolean {
   switch (mode) {
      case "fullText":
         return contents.some((content) => Boolean(content.sourceText.trim()));
      case "codeBlocks": {
         const sourceTexts: string[] = [];

         contents.forEach((content) => createCodeBlockProtectionPlan(content.sourceText, sourceTexts));
         return sourceTexts.length > 0;
      }
      case "remotePlaceholders":
      case "localPlaceholders":
         return contents.some((content) => content.value.some((value) => value.isTranslatable));
   }
}

/** 将每个 Hover 的原始 Markdown 整体发送给翻译服务，不保护任何结构。 */
async function translateFullText(contents: readonly TranslatableContent[], translate: TranslationInvoker): Promise<string> {
   const sourceTexts = contents.map((content) => content.sourceText).filter((sourceText) => sourceText.trim());
   const translatedTexts = await invokeTranslation(sourceTexts, translate);

   return translatedTexts.join("\n\n");
}

/** 扫描原始 Markdown，把围栏代码和缩进代码登记为不发送的字面片段。 */
function createCodeBlockProtectionPlan(sourceText: string, sourceTexts: string[]): TranslationPlan {
   const parts: TranslationPlanPart[] = [];
   const lines = sourceText.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter((line) => line.length > 0) ?? [];
   let translatableText = "";
   let fence: { readonly marker: "`" | "~"; readonly length: number } | undefined;

   const flushTranslatableText = (): void => {
      appendPlannedText(parts, translatableText, sourceTexts);
      translatableText = "";
   };

   for (const line of lines) {
      const lineContent = line.replace(/\r?\n$/, "");

      if (fence) {
         appendLiteralPart(parts, line);

         const closingFence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lineContent);

         if (closingFence && closingFence[1][0] === fence.marker && closingFence[1].length >= fence.length) {
            fence = undefined;
         }

         continue;
      }

      const openingFence = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/.exec(lineContent);

      if (openingFence) {
         flushTranslatableText();
         appendLiteralPart(parts, line);
         fence = {
            marker: openingFence[1][0] as "`" | "~",
            length: openingFence[1].length,
         };
         continue;
      }

      if (/^(?: {4}|\t)/.test(lineContent)) {
         flushTranslatableText();
         appendLiteralPart(parts, line);
         continue;
      }

      translatableText += line;
   }

   flushTranslatableText();
   return { parts };
}

/** 只把围栏代码块和缩进代码保留在本地，其余原始 Markdown 按位置翻译。 */
async function translateWithCodeBlockProtection(
   contents: readonly TranslatableContent[],
   translate: TranslationInvoker,
): Promise<string> {
   const sourceTexts: string[] = [];
   const plans = contents.map((content) => createCodeBlockProtectionPlan(content.sourceText, sourceTexts));
   const translatedTexts = await invokeTranslation(sourceTexts, translate);

   return plans.map((plan) => restoreTranslationPlan(plan, translatedTexts)).join("\n\n");
}

/** 使用原方案：占位符随文本发送给平台，平台必须将 token 完整回传。 */
async function translateWithRemotePlaceholders(
   contents: readonly TranslatableContent[],
   translate: TranslationInvoker,
): Promise<string> {
   const sourceTexts = contents.flatMap((content) =>
      content.value.filter((value) => value.isTranslatable).map((value) => value.text),
   );
   const translatedTexts = await invokeTranslation(sourceTexts, translate);

   return restoreStructuredContents(contents, translatedTexts, (value, translatedText) =>
      restoreTranslationPlaceholders(value.text, translatedText, value.placeholders),
   );
}

/** 使用默认方案：占位符保留在本地，只把 token 之间的自然语言发送给平台。 */
async function translateWithLocalPlaceholders(
   contents: readonly TranslatableContent[],
   translate: TranslationInvoker,
): Promise<string> {
   const sourceTexts: string[] = [];
   const translationPlans = contents.flatMap((content) =>
      content.value
         .filter((value) => value.isTranslatable)
         .map((value) => createTranslationPlan(value.text, value.placeholders, sourceTexts)),
   );

   const translatedTexts = await invokeTranslation(sourceTexts, translate);

   return restoreStructuredContents(contents, translationPlans, (value, plan) => {
      const translatedText = restoreTranslationPlan(plan, translatedTexts);

      return restoreTranslationPlaceholders(value.text, translatedText, value.placeholders);
   });
}

/** 调用平台并统一校验批量响应数量。 */
async function invokeTranslation(sourceTexts: readonly string[], translate: TranslationInvoker): Promise<string[]> {
   if (sourceTexts.length === 0) {
      throw new Error("没有可翻译的内容");
   }

   const translatedTexts = await translate(sourceTexts);

   if (translatedTexts.length !== sourceTexts.length) {
      throw new Error("翻译服务返回的译文数量与原文数量不一致");
   }

   return translatedTexts;
}

/** 按分析器原有结构合并可翻译值和代码块等字面值。 */
function restoreStructuredContents<TResult>(
   contents: readonly TranslatableContent[],
   translatedResults: readonly TResult[],
   restore: (value: TranslatableContent["value"][number], result: TResult) => string,
): string {
   const translatedContents: string[] = [];
   let translatedValueIndex = 0;

   output.appendLine("---------- 结构恢复前译文 ---------- \n");

   for (const content of contents) {
      const translatedValues = content.value.map((value) => {
         if (!value.isTranslatable) {
            return value.text;
         }

         const result = restore(value, translatedResults[translatedValueIndex]);

         output.appendLine(`${result}\n`);
         translatedValueIndex += 1;
         return result;
      });

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
      .map((placeholder) => ({ placeholder, index: sourceText.indexOf(placeholder.token) }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => left.index - right.index);
   let sourceIndex = 0;

   for (const { placeholder, index } of positionedPlaceholders) {
      appendPlannedText(parts, sourceText.slice(sourceIndex, index), sourceTexts);
      appendLiteralPart(parts, placeholder.token);
      sourceIndex = index + placeholder.token.length;
   }

   appendPlannedText(parts, sourceText.slice(sourceIndex), sourceTexts);

   return { parts };
}

/** 登记一个可能包含首尾空白的自然语言片段。 */
function appendPlannedText(parts: TranslationPlanPart[], text: string, sourceTexts: string[]): void {
   const trimmedText = text.trim();

   if (!trimmedText || !/\p{L}/u.test(trimmedText)) {
      appendLiteralPart(parts, text);
      return;
   }

   const trimmedTextIndex = text.indexOf(trimmedText);

   appendLiteralPart(parts, text.slice(0, trimmedTextIndex));
   parts.push({ kind: "translated", translationIndex: sourceTexts.push(trimmedText) - 1 });
   appendLiteralPart(parts, text.slice(trimmedTextIndex + trimmedText.length));
}

/** 合并相邻字面片段，避免翻译计划产生无意义的碎片。 */
function appendLiteralPart(parts: TranslationPlanPart[], text: string): void {
   if (!text) {
      return;
   }

   const previousPart = parts.at(-1);

   if (previousPart?.kind === "literal") {
      parts[parts.length - 1] = { kind: "literal", text: previousPart.text + text };
      return;
   }

   parts.push({ kind: "literal", text });
}

/** 按翻译计划合并平台返回的自然语言片段和本地保存的精确占位符。 */
function restoreTranslationPlan(plan: TranslationPlan, translatedTexts: readonly string[]): string {
   return plan.parts.map((part) => (part.kind === "literal" ? part.text : translatedTexts[part.translationIndex])).join("");
}
