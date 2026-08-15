/** 凭据可存放在普通用户设置或 VS Code 提供的加密存储中。 */
export type CredentialStorage = "settings" | "secretStorage";

/** 控制发送给翻译服务的内容范围及受保护内容的处理位置。 */
export type TranslationMode = "fullText" | "codeBlocks" | "remotePlaceholders" | "localPlaceholders";

/** 扩展运行一次翻译所需的完整配置快照。 */
export interface FloatingTranslationConfiguration {
   /** 当前选用的翻译服务标识。 */
   readonly translationTool: string;
   /** 当前使用的内容翻译尺度。 */
   readonly translationMode: TranslationMode;
   /** API 凭据的读取和写入位置。 */
   readonly credentialStorage: CredentialStorage;
   /** 阿里云 AccessKey ID。 */
   readonly aliyunAccessKeyId: string;
   /** 阿里云 AccessKey Secret。 */
   readonly aliyunAccessKeySecret: string;
   /** 百度翻译开放平台 APPID。 */
   readonly baiduAppId: string;
   /** 百度翻译开放平台密钥。 */
   readonly baiduAppKey: string;
   /** 阿里云和百度翻译每秒启动及同时进行的最大请求数。 */
   readonly QPS: number;
   /** OpenAI 兼容服务的完整 Chat Completions 请求地址。 */
   readonly openAiCompatibleEndpoint: string;
   /** OpenAI 兼容服务的 API Key。 */
   readonly openAiCompatibleApiKey: string;
   /** OpenAI 兼容服务的模型标识符。 */
   readonly openAiCompatibleModel: string;
   /** 翻译请求使用的源语言代码，通常允许使用 auto。 */
   readonly sourceLanguage: string;
   /** 翻译请求使用的目标语言代码，空值表示跟随 VS Code 显示语言。 */
   readonly targetLanguage: string;
   /** 预留给支持提示词的翻译服务使用。 */
   readonly customPrompt: string;
}

/** 可以通过 ConfigTool 直接读写的字符串配置项。 */
export type ConfigurationName = Exclude<keyof FloatingTranslationConfiguration, "QPS">;
