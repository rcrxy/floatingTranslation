import { createHash } from "node:crypto";
import * as vscode from "vscode";

export type TranslatableContentResult = {
   readonly key: string;
   readonly isTranslatable: boolean;
   readonly contents: readonly TranslatableContent[];
};

export type TranslatableContent = {
   readonly value: readonly TranslatableContentValue[];
   readonly sourceText: string;
};

export type TranslatableContentValue = {
   readonly text: string;
   readonly isTranslatable: boolean;
   readonly placeholders: readonly TranslationPlaceholder[];
};

export type TranslationPlaceholder = {
   readonly token: string;
   readonly source: string;
};

type Fence = {
   readonly marker: "`" | "~";
   readonly length: number;
};

const openingFencePattern = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/;
const listItemPattern = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+(.*)$/;
const headingPattern = /^ {0,3}#{1,6}[ \t]+(.*)$/;
const blockQuotePattern = /^ {0,3}>[ \t]?(.*)$/;
const definitionPattern = /^ {0,3}\[[^\]]+\]:[ \t]*\S+/;
const thematicBreakPattern = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;
const placeholderPattern = /\{\{\d{10}:\d{4,}\}\}/g;

export function restoreTranslationPlaceholders(
   sourceText: string,
   translatedText: string,
   placeholders: readonly TranslationPlaceholder[],
): string {
   const expectedPlaceholders = placeholders.filter((placeholder) => sourceText.includes(placeholder.token));
   const expectedTokens = new Set(expectedPlaceholders.map((placeholder) => placeholder.token));
   const translatedTokens = translatedText.match(placeholderPattern) ?? [];

   for (const token of translatedTokens) {
      if (!expectedTokens.has(token)) {
         throw new Error(`译文包含未知占位符：${token}`);
      }
   }

   let restoredText = translatedText;
   const missingPlaceholders: TranslationPlaceholder[] = [];

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
      restoredText += `\n\n${createMissingPlaceholderCodeBlock(missingPlaceholders)}`;
   }

   return restoredText;
}

function createMissingPlaceholderCodeBlock(placeholders: readonly TranslationPlaceholder[]): string {
   const report = placeholders
      .map((placeholder) => `未替换的占位符：${placeholder.token}\n原内容：${placeholder.source}`)
      .join("\n\n");
   const longestBacktickSequence = Math.max(0, ...Array.from(report.matchAll(/`+/g), (match) => match[0].length));
   const fence = "`".repeat(Math.max(3, longestBacktickSequence + 1));

   return `${fence}text\n${report}\n${fence}`;
}

export class TranslatableContentAnalyzer {
   public constructor(private readonly hovers: readonly vscode.Hover[]) {}

   public invoke(): TranslatableContentResult {
      const contents = this.hovers.map((hover) => this.transitionContent(hover));
      const sourceTexts = contents.map((content) => content.sourceText);

      return {
         key: this.createContentKey(JSON.stringify(sourceTexts)),
         isTranslatable: contents.some((content) => content.value.some((value) => value.isTranslatable)),
         contents,
      };
   }

   private transitionContent(hover: vscode.Hover): TranslatableContent {
      const sourceText = this.extractSourceText(hover);
      const placeholderPrefix = this.createPlaceholderPrefix(sourceText);
      let placeholderIndex = 0;

      return {
         value: this.extractValues(sourceText, (text) => {
            const placeholders: TranslationPlaceholder[] = [];
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

   private extractSourceText(hover: vscode.Hover): string {
      return hover.contents.map((content) => this.toMarkdown(content)).join("\n\n");
   }

   private toMarkdown(content: vscode.MarkdownString | vscode.MarkedString): string {
      if (typeof content === "string") {
         return content;
      }

      if ("language" in content && typeof content.language === "string") {
         return `\`\`\`${content.language}\n${content.value}\n\`\`\``;
      }

      return content.value;
   }

   private extractValues(
      sourceText: string,
      createTextValue: (text: string) => TranslatableContentValue,
   ): TranslatableContentValue[] {
      const values: TranslatableContentValue[] = [];
      const paragraphLines: string[] = [];
      let fence: Fence | undefined;
      let fenceLines: string[] = [];

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
            flushParagraph();
            values.push(this.createLiteralValue(line));
            continue;
         }

         const listItem = listItemPattern.exec(line);

         if (listItem) {
            flushParagraph();
            paragraphLines.push(listItem[1]);
            continue;
         }

         const heading = headingPattern.exec(line);

         if (heading) {
            flushParagraph();
            paragraphLines.push(heading[1]);
            flushParagraph();
            continue;
         }

         const blockQuote = blockQuotePattern.exec(line);

         if (blockQuote) {
            paragraphLines.push(blockQuote[1]);
            continue;
         }

         paragraphLines.push(line.trim());
      }

      flushParagraph();

      if (fenceLines.length > 0) {
         values.push(this.createLiteralValue(fenceLines.join("\n")));
      }

      return values;
   }

   private createLiteralValue(text: string): TranslatableContentValue {
      return {
         text,
         isTranslatable: false,
         placeholders: [],
      };
   }

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

   private isClosingFence(line: string, fence: Fence): boolean {
      const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);

      return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
   }

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
         return source.slice(0, -flag.length) + protect(flag);
      });
      result = result.replace(/\b(?:[A-Za-z_$][\w$-]*\.)+[A-Za-z_$][\w$-]*\b/g, (source) => protect(source));
      result = result.replace(/\b[a-z_$][\w$]*[A-Z][\w$]*\b/g, (source) => protect(source));
      result = result.replace(/\b(?:[A-Z][a-z0-9_$]+){2,}[A-Za-z0-9_$]*\b/g, (source) => protect(source));
      result = result.replace(/\b[A-Z][A-Z0-9_]{1,}\b/g, (source) => protect(source));
      result = result.replace(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g, (source) => protect(source));

      return result;
   }

   private hasTranslatableText(sourceText: string, placeholders: readonly TranslationPlaceholder[]): boolean {
      let unprotectedText = sourceText;

      for (const placeholder of placeholders) {
         unprotectedText = unprotectedText.replaceAll(placeholder.token, "");
      }

      return /\p{L}/u.test(unprotectedText);
   }

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

   private createContentKey(value: string): string {
      return createHash("sha256").update(value, "utf8").digest("hex");
   }
}
