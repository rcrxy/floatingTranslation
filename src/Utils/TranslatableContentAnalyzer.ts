import { createHash } from "node:crypto";
import * as vscode from "vscode";

/** 一次 Hover 分析的汇总结果。 */
export type TranslatableContentResult = {
   /** 基于原始 Hover 内容生成的稳定摘要。 */
   readonly key: string;
   /** 是否至少存在一个可发送到翻译服务的片段。 */
   readonly isTranslatable: boolean;
   /** 按原始 Hover 顺序保存的结构化内容。 */
   readonly contents: readonly TranslatableContent[];
};

/** 单个 Hover 的原文及其拆分结果。 */
export type TranslatableContent = {
   /** 按展示顺序排列的可翻译片段和字面片段。 */
   readonly value: readonly TranslatableContentValue[];
   /** 未经拆分和占位符替换的完整 Markdown。 */
   readonly sourceText: string;
};

/** 可单独处理的一段 Hover 内容。 */
export type TranslatableContentValue = {
   /** 可翻译文本，或应原样保留的字面文本。 */
   readonly text: string;
   /** true 表示 text 可以发送到翻译服务。 */
   readonly isTranslatable: boolean;
   /** 翻译后需要恢复到 text 中的 Markdown 或代码片段。 */
   readonly placeholders: readonly TranslationPlaceholder[];
};

/** 翻译前临时替换受保护内容的占位符。 */
export type TranslationPlaceholder = {
   /** 发送给翻译服务的唯一临时标记。 */
   readonly token: string;
   /** 完成翻译后需要原样恢复的内容。 */
   readonly source: string;
};

/** 当前正在收集的 Markdown 代码围栏特征。 */
type Fence = {
   /** 围栏使用反引号或波浪号。 */
   readonly marker: "`" | "~";
   /** 起始围栏长度，结束围栏不得短于该值。 */
   readonly length: number;
};

// 这些模式只识别影响段落边界的块级 Markdown 结构。
const openingFencePattern = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/;
const listItemPattern = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+(.*)$/;
const headingPattern = /^ {0,3}#{1,6}[ \t]+(.*)$/;
const blockQuotePattern = /^ {0,3}>[ \t]?(.*)$/;
const definitionPattern = /^ {0,3}\[[^\]]+\]:[ \t]*\S+/;
const thematicBreakPattern = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;
// 占位符格式固定，便于检测翻译服务篡改、复制或凭空生成的标记。
const placeholderPattern = /\{\{\d{10}:\d{4,}\}\}/g;

/**
 * 校验翻译服务返回的占位符，并恢复其对应的原始 Markdown 内容。
 * 未知或重复占位符会中止恢复；丢失的占位符会附加到结果末尾以避免内容静默丢失。
 */
export function restoreTranslationPlaceholders(
   sourceText: string,
   translatedText: string,
   placeholders: readonly TranslationPlaceholder[],
): string {
   const expectedPlaceholders = placeholders.filter((placeholder) => sourceText.includes(placeholder.token));
   const expectedTokens = new Set(expectedPlaceholders.map((placeholder) => placeholder.token));
   const translatedTokens = translatedText.match(placeholderPattern) ?? [];

   // 译文不得引入原文中不存在的占位符，否则无法判断其真实来源。
   for (const token of translatedTokens) {
      if (!expectedTokens.has(token)) {
         throw new Error(`译文包含未知占位符：${token}`);
      }
   }

   let restoredText = translatedText;
   const missingPlaceholders: TranslationPlaceholder[] = [];

   // 每个预期占位符只能出现一次，防止翻译服务复制受保护内容。
   for (const placeholder of expectedPlaceholders) {
      const occurrenceCount = translatedTokens.filter((token) => token === placeholder.token).length;

      if (occurrenceCount === 0) {
         missingPlaceholders.push(placeholder);
         continue;
      }

      if (occurrenceCount > 1) {
         throw new Error(`译文占位符数量异常：${placeholder.token}，期望 1 个，实际 ${occurrenceCount} 个`);
      }

      restoredText = restoredText.replace(placeholder.token, placeholder.source);
   }

   if (missingPlaceholders.length > 0) {
      // 丢失内容不能安全定位回原段落，因此以诊断代码块附加，确保信息仍可见。
      restoredText += `\n\n${createMissingPlaceholderCodeBlock(missingPlaceholders)}`;
   }

   return restoredText;
}

/** 生成不会与报告内容中的反引号冲突的 Markdown 代码围栏。 */
function createMissingPlaceholderCodeBlock(placeholders: readonly TranslationPlaceholder[]): string {
   const report = placeholders
      .map((placeholder) => `未替换的占位符：${placeholder.token}\n原内容：${placeholder.source}`)
      .join("\n\n");
   const longestBacktickSequence = Math.max(0, ...Array.from(report.matchAll(/`+/g), (match) => match[0].length));
   // 围栏比报告中最长的连续反引号多一个，避免内容提前闭合代码块。
   const fence = "`".repeat(Math.max(3, longestBacktickSequence + 1));

   return `${fence}text\n${report}\n${fence}`;
}

/** 将 VS Code Hover 转换为保留展示顺序的可翻译文本和字面内容。 */
export class TranslatableContentAnalyzer {
   /** 接收 executeHoverProvider 返回的全部 Hover 结果。 */
   public constructor(private readonly hovers: readonly vscode.Hover[]) {}

   /** 分析所有 Hover，并生成可用于缓存判等的内容摘要。 */
   public invoke(): TranslatableContentResult {
      const contents = this.hovers.map((hover) => this.transitionContent(hover));
      const sourceTexts = contents.map((content) => content.sourceText);

      return {
         key: this.createContentKey(JSON.stringify(sourceTexts)),
         isTranslatable: contents.some((content) => content.value.some((value) => value.isTranslatable)),
         contents,
      };
   }

   /** 分析单个 Hover，并为其中需要保护的内容分配唯一占位符。 */
   private transitionContent(hover: vscode.Hover): TranslatableContent {
      const sourceText = this.extractSourceText(hover);
      const placeholderPrefix = this.createPlaceholderPrefix(sourceText);
      // 同一 Hover 内共享计数器，确保跨段落的占位符也不重复。
      let placeholderIndex = 0;

      return {
         value: this.extractValues(sourceText, (text) => {
            const placeholders: TranslationPlaceholder[] = [];
            // 每次保护都同时登记 token 与原文，供翻译完成后严格恢复。
            const protect = (source: string): string => {
               const token = `{{${placeholderPrefix}:${placeholderIndex.toString().padStart(4, "0")}}}`;

               placeholderIndex += 1;
               placeholders.push({ token, source });

               return token;
            };
            const protectedText = this.protectMarkdown(text, protect);

            return {
               text: protectedText,
               isTranslatable: this.hasTranslatableText(protectedText, placeholders),
               placeholders,
            };
         }),
         sourceText,
      };
   }

   /** 将 Hover 的多个内容项合并为统一的 Markdown 文本。 */
   private extractSourceText(hover: vscode.Hover): string {
      return hover.contents.map((content) => this.toMarkdown(content)).join("\n\n");
   }

   /** 把 VS Code 的 MarkedString 兼容结构归一化为 Markdown。 */
   private toMarkdown(content: vscode.MarkdownString | vscode.MarkedString): string {
      if (typeof content === "string") {
         return content;
      }

      if ("language" in content && typeof content.language === "string") {
         // 带语言标记的旧式 MarkedString 等价于 Markdown 代码围栏。
         return `\`\`\`${content.language}\n${content.value}\n\`\`\``;
      }

      return content.value;
   }

   /**
    * 按 Markdown 块级结构拆分文本。
    * 代码围栏和定义等结构保持字面值，自然语言段落交给 createTextValue 判断和保护。
    */
   private extractValues(
      sourceText: string,
      createTextValue: (text: string) => TranslatableContentValue,
   ): TranslatableContentValue[] {
      const values: TranslatableContentValue[] = [];
      const paragraphLines: string[] = [];
      let fence: Fence | undefined;
      let fenceLines: string[] = [];

      // 段落可能跨多行，提交时折叠为适合翻译服务处理的单行文本。
      const flushParagraph = (): void => {
         if (paragraphLines.length === 0) {
            return;
         }

         const paragraph = paragraphLines
            .join(" ")
            .replace(/[ \t]+/g, " ")
            .trim();

         paragraphLines.length = 0;

         if (!paragraph) {
            return;
         }

         const value = createTextValue(paragraph);

         values.push(value.isTranslatable ? value : this.createLiteralValue(paragraph));
      };

      for (const line of sourceText.split(/\r?\n/)) {
         if (fence) {
            // 代码围栏内部不解析任何 Markdown，直到匹配到合法结束围栏。
            fenceLines.push(line);

            if (this.isClosingFence(line, fence)) {
               values.push(this.createLiteralValue(fenceLines.join("\n")));
               fence = undefined;
               fenceLines = [];
            }

            continue;
         }

         const openingFence = this.readOpeningFence(line);

         if (openingFence) {
            // 围栏前的自然语言段落必须先提交，避免与代码块合并。
            flushParagraph();
            fence = openingFence;
            fenceLines = [line];
            continue;
         }

         if (!line.trim()) {
            flushParagraph();
            continue;
         }

         if (definitionPattern.test(line) || thematicBreakPattern.test(line) || /^(?: {4}|\t)/.test(line)) {
            // 链接定义、分隔线和缩进代码依赖原始格式，作为字面值保留。
            flushParagraph();
            values.push(this.createLiteralValue(line));
            continue;
         }

         const listItem = listItemPattern.exec(line);

         if (listItem) {
            // 列表标记不参与翻译，只翻译列表项的正文。
            flushParagraph();
            paragraphLines.push(listItem[1]);
            continue;
         }

         const heading = headingPattern.exec(line);

         if (heading) {
            // 标题独立成段，避免和后续正文被翻译为同一句话。
            flushParagraph();
            paragraphLines.push(heading[1]);
            flushParagraph();
            continue;
         }

         const blockQuote = blockQuotePattern.exec(line);

         if (blockQuote) {
            // 引用标记不参与翻译，相邻引用行仍合并为一个段落。
            paragraphLines.push(blockQuote[1]);
            continue;
         }

         paragraphLines.push(line.trim());
      }

      flushParagraph();

      if (fenceLines.length > 0) {
         // 未闭合围栏仍按字面内容保留，不能把疑似代码发送到翻译服务。
         values.push(this.createLiteralValue(fenceLines.join("\n")));
      }

      return values;
   }

   /** 创建不会发送到翻译服务的字面内容。 */
   private createLiteralValue(text: string): TranslatableContentValue {
      return {
         text,
         isTranslatable: false,
         placeholders: [],
      };
   }

   /** 识别 Markdown 起始代码围栏并记录其结束条件。 */
   private readOpeningFence(line: string): Fence | undefined {
      const match = openingFencePattern.exec(line);

      if (!match) {
         return undefined;
      }

      return {
         marker: match[1][0] as Fence["marker"],
         length: match[1].length,
      };
   }

   /** 判断当前行是否使用相同标记且长度足够，可结束指定代码围栏。 */
   private isClosingFence(line: string, fence: Fence): boolean {
      const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);

      return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
   }

   /**
    * 用占位符保护不应被翻译的 Markdown、链接、路径、命令参数和代码标识符。
    * 替换顺序从较完整的结构到较局部的标识符，避免重复保护同一内容。
    */
   private protectMarkdown(sourceText: string, protect: (source: string) => string): string {
      let result = sourceText;

      result = result.replace(/(`+)[\s\S]*?\1/g, (source) => protect(source));
      result = result.replace(/!\[[^\]]*\]\([^\r\n)]*\)/g, (source) => protect(source));
      result = result.replace(/\[[^\]]+\]\([^\r\n)]*\)/g, (source) => protect(source));
      result = result.replace(/\[[^\]]+\]\[[^\]]*\]/g, (source) => protect(source));
      result = result.replace(/~~[^~\r\n]+~~/g, (source) => protect(source));
      result = result.replace(/\*\*[^*\r\n]+\*\*|__[^_\r\n]+__/g, (source) => protect(source));
      result = result.replace(/\*[^*\r\n]+\*|_[^_\r\n]+_/g, (source) => protect(source));
      result = result.replace(/\\[\\`*_[\]{}()#+.!-]/g, (source) => protect(source));
      result = result.replace(/<(?:https?:\/\/|file:|command:|mailto:)[^>]+>/gi, (source) => protect(source));
      result = result.replace(/<\/?[A-Za-z][^>]*>/g, (source) => protect(source));
      result = result.replace(/\b(?:https?:\/\/|file:\/{1,3}|command:)[^\s<>()]+/gi, (source) => protect(source));
      result = result.replace(/\b[A-Za-z]:[\\/][^\s<>()]+/g, (source) => protect(source));
      result = result.replace(/@[A-Za-z][\w-]*/g, (source) => protect(source));
      result = result.replace(/(?:^|\s)(--?[A-Za-z][\w-]*)/g, (source, flag: string) => {
         // 保留命令参数前的空白，只用占位符替换参数本身。
         return source.slice(0, -flag.length) + protect(flag);
      });
      result = result.replace(/\b(?:[A-Za-z_$][\w$-]*\.)+[A-Za-z_$][\w$-]*\b/g, (source) => protect(source));
      result = result.replace(/\b[a-z_$][\w$]*[A-Z][\w$]*\b/g, (source) => protect(source));
      result = result.replace(/\b(?:[A-Z][a-z0-9_$]+){2,}[A-Za-z0-9_$]*\b/g, (source) => protect(source));
      result = result.replace(/\b[A-Z][A-Z0-9_]{1,}\b/g, (source) => protect(source));
      result = result.replace(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g, (source) => protect(source));

      return result;
   }

   /** 移除占位符后，检查片段是否仍包含至少一个自然语言字母。 */
   private hasTranslatableText(sourceText: string, placeholders: readonly TranslationPlaceholder[]): boolean {
      let unprotectedText = sourceText;

      for (const placeholder of placeholders) {
         unprotectedText = unprotectedText.replaceAll(placeholder.token, "");
      }

      return /\p{L}/u.test(unprotectedText);
   }

   /**
    * 为单个 Hover 生成确定的十位数字前缀。
    * 若原文已包含相同占位符前缀，则增加 salt 重新计算以避免误替换用户内容。
    */
   private createPlaceholderPrefix(sourceText: string): string {
      let salt = 0;
      let prefix: string;

      do {
         prefix = createHash("sha256")
            .update(`${salt}:${sourceText}`, "utf8")
            .digest()
            .readUInt32BE(0)
            .toString()
            .padStart(10, "0");
         salt += 1;
      } while (sourceText.includes(`{{${prefix}:`));

      return prefix;
   }

   /** 为完整 Hover 内容生成稳定摘要，用于识别内容变化。 */
   private createContentKey(value: string): string {
      return createHash("sha256").update(value, "utf8").digest("hex");
   }
}
