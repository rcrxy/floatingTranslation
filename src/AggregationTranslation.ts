import * as vscode from "vscode";
import { AliyunTranslation } from "./modules/aliyun";
import { output } from "./Utils/output";
import { restoreTranslationPlaceholders, type TranslatableContent } from "./Utils/TranslatableContentAnalyzer";

type TranslationInvoker = (sourceText: string) => Promise<string>;

export function AggregationTranslation(contents: readonly TranslatableContent[]): Promise<string> {
   const configuration = vscode.workspace.getConfiguration("floatingTranslation");
   const translationTool = configuration.get<string>("translationTool", "aliyun");
   const sourceLanguage = configuration.get<string>("sourceLanguage", "auto").trim() || "auto";
   const targetLanguage = configuration.get<string>("targetLanguage", "").trim() || vscode.env.language;

   switch (translationTool) {
      case "aliyun": {
         const aliyun = new AliyunTranslation(sourceLanguage, targetLanguage);
         return translateContents(contents, (sourceText) => aliyun.invoke(sourceText));
      }
      default:
         return Promise.reject(new Error(`不支持的翻译工具：${translationTool}`));
   }
}

async function translateContents(contents: readonly TranslatableContent[], translate: TranslationInvoker): Promise<string> {
   const translatedContents: string[] = [];
   let translatedValueCount = 0;

   for (const content of contents) {
      const translatedValues: string[] = [];

      for (const value of content.value) {
         if (!value.isTranslatable) {
            translatedValues.push(value.text);
            continue;
         }

         const translatedText = await translate(value.text);

         output.appendLine(`占位符还原前译文：\n${translatedText}`);

         translatedValues.push(restoreTranslationPlaceholders(value.text, translatedText, value.placeholders));
         translatedValueCount += 1;
      }

      if (translatedValues.length > 0) {
         translatedContents.push(translatedValues.join("\n\n"));
      }
   }

   if (translatedValueCount === 0) {
      throw new Error("没有可翻译的内容");
   }

   return translatedContents.join("\n\n");
}
