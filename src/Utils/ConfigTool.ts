import * as vscode from "vscode";

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

type ConfigurationName = keyof FloatingTranslationConfiguration;
type CredentialName = "aliyunAccessKeyId" | "aliyunAccessKeySecret" | "baiduAppId" | "baiduAppKey" | "openAiCompatibleApiKey";
type GeneralPlatformCredentialName = Exclude<CredentialName, "openAiCompatibleApiKey">;
type GeneralPlatformCredentials = Readonly<Record<GeneralPlatformCredentialName, string>>;
type OpenAiCompatibleConfigurationName =
   "openAiCompatibleEndpoint" | "openAiCompatibleApiKey" | "openAiCompatibleModel" | "customPrompt";
type OpenAiCompatibleConfiguration = Readonly<Record<OpenAiCompatibleConfigurationName, string>>;

const configurationSection = "floating-translation";
const generalPlatformCredentialsSetting = "generalPlatformCredentials";
const openAiCompatibleConfigurationSetting = "openAiCompatibleConfiguration";
// 只有凭据字段需要根据 credentialStorage 在两种存储之间路由。
const credentialNames = new Set<ConfigurationName>([
   "aliyunAccessKeyId",
   "aliyunAccessKeySecret",
   "baiduAppId",
   "baiduAppKey",
   "openAiCompatibleApiKey",
]);
const credentialSecretKeys: Readonly<Record<CredentialName, string>> = {
   aliyunAccessKeyId: "credentials.aliyun.accessKeyId",
   aliyunAccessKeySecret: "credentials.aliyun.accessKeySecret",
   baiduAppId: "credentials.baidu.appId",
   baiduAppKey: "credentials.baidu.appKey",
   openAiCompatibleApiKey: "credentials.openaiCompatible.apiKey",
};
const generalPlatformCredentialNames = new Set<ConfigurationName>([
   "aliyunAccessKeyId",
   "aliyunAccessKeySecret",
   "baiduAppId",
   "baiduAppKey",
]);
const openAiCompatibleConfigurationNames = new Set<ConfigurationName>([
   "openAiCompatibleEndpoint",
   "openAiCompatibleApiKey",
   "openAiCompatibleModel",
   "customPrompt",
]);
const defaultGeneralPlatformCredentials: GeneralPlatformCredentials = {
   aliyunAccessKeyId: "",
   aliyunAccessKeySecret: "",
   baiduAppId: "",
   baiduAppKey: "",
};
const defaultOpenAiCompatibleConfiguration: OpenAiCompatibleConfiguration = {
   openAiCompatibleEndpoint: "",
   openAiCompatibleApiKey: "",
   openAiCompatibleModel: "",
   customPrompt: "",
};
// 代码侧默认值与 package.json 保持一致，确保配置清单异常时仍有确定行为。
const defaultValues: FloatingTranslationConfiguration = {
   translationTool: "aliyun",
   translationMode: "localPlaceholders",
   credentialStorage: "settings",
   aliyunAccessKeyId: "",
   aliyunAccessKeySecret: "",
   baiduAppId: "",
   baiduAppKey: "",
   openAiCompatibleEndpoint: "",
   openAiCompatibleApiKey: "",
   openAiCompatibleModel: "",
   sourceLanguage: "auto",
   targetLanguage: "",
   customPrompt: "",
};

/**
 * 统一管理扩展配置，并隔离普通设置与 SecretStorage 的差异。
 * 调用方不需要知道凭据当前存放在哪一种存储中。
 */
export class ConfigTool {
   /** 使用扩展专属的加密存储创建配置工具。 */
   public constructor(private readonly secretStorage: vscode.SecretStorage) {}

   /** 读取一次翻译所需的全部配置，返回同一时刻可消费的配置快照。 */
   public async getAll(): Promise<FloatingTranslationConfiguration> {
      const [
         translationTool,
         translationMode,
         credentialStorage,
         aliyunAccessKeyId,
         aliyunAccessKeySecret,
         baiduAppId,
         baiduAppKey,
         openAiCompatibleEndpoint,
         openAiCompatibleApiKey,
         openAiCompatibleModel,
         sourceLanguage,
         targetLanguage,
         customPrompt,
      ] = await this.many([
         "translationTool",
         "translationMode",
         "credentialStorage",
         "aliyunAccessKeyId",
         "aliyunAccessKeySecret",
         "baiduAppId",
         "baiduAppKey",
         "openAiCompatibleEndpoint",
         "openAiCompatibleApiKey",
         "openAiCompatibleModel",
         "sourceLanguage",
         "targetLanguage",
         "customPrompt",
      ]);

      return {
         translationTool,
         translationMode: normalizeTranslationMode(translationMode),
         credentialStorage: credentialStorage === "secretStorage" ? "secretStorage" : "settings",
         aliyunAccessKeyId,
         aliyunAccessKeySecret,
         baiduAppId,
         baiduAppKey,
         openAiCompatibleEndpoint,
         openAiCompatibleApiKey,
         openAiCompatibleModel,
         sourceLanguage,
         targetLanguage,
         customPrompt,
      };
   }

   /** 直接读取普通用户设置，不对凭据字段执行存储路由。 */
   public getSelect(name: ConfigurationName): string {
      if (generalPlatformCredentialNames.has(name)) {
         return this.getGeneralPlatformCredentials()[name as GeneralPlatformCredentialName];
      }

      if (openAiCompatibleConfigurationNames.has(name)) {
         return this.getOpenAiCompatibleConfiguration()[name as OpenAiCompatibleConfigurationName];
      }

      return vscode.workspace.getConfiguration(configurationSection).get<string>(name, defaultValues[name]).trim();
   }

   /** 并行读取多个配置项；凭据会自动从当前选中的存储读取。 */
   public async many(names: readonly ConfigurationName[]): Promise<string[]> {
      return Promise.all(names.map((name) => this.get(name)));
   }

   /** 按当前存储模式写入配置，两种存储中的凭据互不修改。 */
   public async set(name: ConfigurationName, value: string): Promise<void> {
      const normalizedValue = value.trim();

      if (credentialNames.has(name) && this.getCredentialStorage() === "secretStorage") {
         const secretKey = credentialSecretKeys[name as CredentialName];

         if (normalizedValue) {
            await this.secretStorage.store(secretKey, normalizedValue);
         } else {
            await this.secretStorage.delete(secretKey);
         }

         return;
      }

      await this.updateSetting(name, normalizedValue);
   }

   /** 清除指定平台存放在加密存储中的凭据。 */
   public async clearCredentials(translationTool: "aliyun" | "baidu" | "openaiCompatible"): Promise<void> {
      const names: readonly CredentialName[] =
         translationTool === "aliyun"
            ? ["aliyunAccessKeyId", "aliyunAccessKeySecret"]
            : translationTool === "baidu"
              ? ["baiduAppId", "baiduAppKey"]
              : ["openAiCompatibleApiKey"];

      await Promise.all(names.map((name) => this.secretStorage.delete(credentialSecretKeys[name])));
   }

   /** 清除所有平台存放在加密存储中的凭据。 */
   public async clearAllCredentials(): Promise<void> {
      const names = [...credentialNames] as CredentialName[];

      await Promise.all(names.map((name) => this.secretStorage.delete(credentialSecretKeys[name])));
   }

   /** 根据配置项类型和当前存储模式选择实际读取位置。 */
   private async get(name: ConfigurationName): Promise<string> {
      if (credentialNames.has(name) && this.getCredentialStorage() === "secretStorage") {
         return (await this.secretStorage.get(credentialSecretKeys[name as CredentialName]))?.trim() ?? "";
      }

      return this.getSelect(name);
   }

   /** 将未知或无效的存储模式安全回退为默认的明文设置。 */
   private getCredentialStorage(): CredentialStorage {
      return this.getSelect("credentialStorage") === "secretStorage" ? "secretStorage" : "settings";
   }

   /** 从聚合设置中读取常规翻译平台凭据，并将无效字段回退为空字符串。 */
   private getGeneralPlatformCredentials(): GeneralPlatformCredentials {
      const configuredCredentials = vscode.workspace
         .getConfiguration(configurationSection)
         .get<Partial<Record<GeneralPlatformCredentialName, unknown>>>(generalPlatformCredentialsSetting, {});

      return {
         aliyunAccessKeyId: getCredentialValue("aliyunAccessKeyId"),
         aliyunAccessKeySecret: getCredentialValue("aliyunAccessKeySecret"),
         baiduAppId: getCredentialValue("baiduAppId"),
         baiduAppKey: getCredentialValue("baiduAppKey"),
      };

      function getCredentialValue(name: GeneralPlatformCredentialName): string {
         const value = configuredCredentials[name] ?? defaultGeneralPlatformCredentials[name];
         return typeof value === "string" ? value.trim() : "";
      }
   }

   /** 从聚合设置中读取 OpenAI 兼容服务配置，并将无效字段回退为空字符串。 */
   private getOpenAiCompatibleConfiguration(): OpenAiCompatibleConfiguration {
      const configuredValues = vscode.workspace
         .getConfiguration(configurationSection)
         .get<Partial<Record<OpenAiCompatibleConfigurationName, unknown>>>(openAiCompatibleConfigurationSetting, {});

      return {
         openAiCompatibleEndpoint: getConfigurationValue("openAiCompatibleEndpoint"),
         openAiCompatibleApiKey: getConfigurationValue("openAiCompatibleApiKey"),
         openAiCompatibleModel: getConfigurationValue("openAiCompatibleModel"),
         customPrompt: getConfigurationValue("customPrompt"),
      };

      function getConfigurationValue(name: OpenAiCompatibleConfigurationName): string {
         const value = configuredValues[name] ?? defaultOpenAiCompatibleConfiguration[name];
         return typeof value === "string" ? value.trim() : "";
      }
   }

   /** 所有普通设置统一写入用户级配置，避免凭据落入工作区文件。 */
   private async updateSetting(name: ConfigurationName, value: string): Promise<void> {
      if (generalPlatformCredentialNames.has(name)) {
         await this.updateGeneralPlatformCredentials({
            ...this.getGeneralPlatformCredentials(),
            [name]: value,
         });
         return;
      }

      if (openAiCompatibleConfigurationNames.has(name)) {
         await this.updateOpenAiCompatibleConfiguration({
            ...this.getOpenAiCompatibleConfiguration(),
            [name]: value,
         });
         return;
      }

      await vscode.workspace.getConfiguration(configurationSection).update(name, value, vscode.ConfigurationTarget.Global);
   }

   /** 将完整的常规平台凭据对象写入用户级设置。 */
   private async updateGeneralPlatformCredentials(credentials: GeneralPlatformCredentials): Promise<void> {
      await vscode.workspace
         .getConfiguration(configurationSection)
         .update(generalPlatformCredentialsSetting, credentials, vscode.ConfigurationTarget.Global);
   }

   /** 将完整的 OpenAI 兼容服务配置对象写入用户级设置。 */
   private async updateOpenAiCompatibleConfiguration(configuration: OpenAiCompatibleConfiguration): Promise<void> {
      await vscode.workspace
         .getConfiguration(configurationSection)
         .update(openAiCompatibleConfigurationSetting, configuration, vscode.ConfigurationTarget.Global);
   }
}

/** 将未知设置值回退到不会把占位符发送给第三方服务的默认模式。 */
export function normalizeTranslationMode(value: string): TranslationMode {
   switch (value) {
      case "fullText":
      case "codeBlocks":
      case "remotePlaceholders":
      case "localPlaceholders":
         return value;
      default:
         return "localPlaceholders";
   }
}
