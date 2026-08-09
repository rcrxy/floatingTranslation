import * as vscode from "vscode";
import { AliyunTranslation } from "./modules/aliyun";

export function AggregationTranslation(sourceText: string): Promise<string> {
   const configuration = vscode.workspace.getConfiguration("floatingTranslation");
   const translationTool = configuration.get<string>("translationTool", "aliyun");
   const sourceLanguage = configuration.get<string>("sourceLanguage", "auto").trim() || "auto";
   const targetLanguage = configuration.get<string>("targetLanguage", "").trim() || vscode.env.language;

   switch (translationTool) {
      case "aliyun": {
         const aliyun = new AliyunTranslation(sourceLanguage, targetLanguage);
         return aliyun.invoke(sourceText);
      }
      default:
         return Promise.reject(new Error(`不支持的翻译工具：${translationTool}`));
   }
}
