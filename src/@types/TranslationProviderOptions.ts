import type { TranslationMode } from "./TranslationConfiguration";

/** 所有翻译适配器共用的语言与并发配置。 */
export interface TranslationProviderOptions {
   readonly sourceLanguage: string;
   readonly targetLanguage: string;
   readonly concurrency?: number;
}

/** 创建阿里云翻译适配器所需的完整、与 VS Code 无关的配置。 */
export interface AliyunTranslationOptions extends TranslationProviderOptions {
   readonly accessKeyId: string;
   readonly accessKeySecret: string;
}

/** 创建百度翻译适配器所需的完整、与 VS Code 无关的配置。 */
export interface BaiduTranslationOptions extends TranslationProviderOptions {
   readonly appId: string;
   readonly appKey: string;
}

/** 创建 OpenAI 兼容翻译适配器所需的完整、与 VS Code 无关的配置。 */
export interface OpenAiCompatibleTranslationOptions extends TranslationProviderOptions {
   readonly endpoint: string;
   readonly apiKey: string;
   readonly model: string;
   readonly translationMode: TranslationMode;
   readonly customPrompt: string;
   readonly requestTimeoutMilliseconds?: number;
}
