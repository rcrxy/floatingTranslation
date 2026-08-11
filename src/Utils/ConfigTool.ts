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
   /** 翻译服务的公开访问密钥。 */
   readonly apiKey: string;
   /** 翻译服务的私密访问密钥。 */
   readonly secretKey: string;
   /** 翻译请求使用的源语言代码，通常允许使用 auto。 */
   readonly sourceLanguage: string;
   /** 翻译请求使用的目标语言代码，空值表示跟随 VS Code 显示语言。 */
   readonly targetLanguage: string;
   /** 预留给支持提示词的翻译服务使用。 */
   readonly customPrompt: string;
}

type ConfigurationName = keyof FloatingTranslationConfiguration;

const configurationSection = "floating-translation";
// 只有凭据字段需要根据 credentialStorage 在两种存储之间路由。
const credentialNames = new Set<ConfigurationName>(["apiKey", "secretKey"]);
// 代码侧默认值与 package.json 保持一致，确保配置清单异常时仍有确定行为。
const defaultValues: FloatingTranslationConfiguration = {
   translationTool: "aliyun",
   translationMode: "localPlaceholders",
   credentialStorage: "settings",
   apiKey: "",
   secretKey: "",
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
         apiKey,
         secretKey,
         sourceLanguage,
         targetLanguage,
         customPrompt,
      ] = await this.many([
         "translationTool",
         "translationMode",
         "credentialStorage",
         "apiKey",
         "secretKey",
         "sourceLanguage",
         "targetLanguage",
         "customPrompt",
      ]);

      return {
         translationTool,
         translationMode: normalizeTranslationMode(translationMode),
         credentialStorage: credentialStorage === "secretStorage" ? "secretStorage" : "settings",
         apiKey,
         secretKey,
         sourceLanguage,
         targetLanguage,
         customPrompt,
      };
   }

   /** 直接读取普通用户设置，不对凭据字段执行存储路由。 */
   public getSelect(name: ConfigurationName): string {
      return vscode.workspace.getConfiguration(configurationSection).get<string>(name, defaultValues[name]).trim();
   }

   /** 并行读取多个配置项；凭据会自动从当前选中的存储读取。 */
   public async many(names: readonly ConfigurationName[]): Promise<string[]> {
      return Promise.all(names.map((name) => this.get(name)));
   }

   /**
    * 按当前存储模式写入配置。
    * 写入凭据时会清除另一种存储中的副本，避免切换模式后读到旧值。
    */
   public async set(name: ConfigurationName, value: string): Promise<void> {
      const normalizedValue = value.trim();

      if (credentialNames.has(name) && this.getCredentialStorage() === "secretStorage") {
         if (normalizedValue) {
            await this.secretStorage.store(name, normalizedValue);
         } else {
            await this.secretStorage.delete(name);
         }

         await this.updateSetting(name, "");

         return;
      }

      await this.updateSetting(name, normalizedValue);

      if (credentialNames.has(name)) {
         // 明文模式以设置值为唯一来源，因此同步删除可能残留的加密副本。
         await this.secretStorage.delete(name);
      }
   }

   /** 同时清除普通设置和加密存储中的全部凭据。 */
   public async clearCredentials(): Promise<void> {
      await Promise.all([
         this.updateSetting("apiKey", ""),
         this.updateSetting("secretKey", ""),
         this.secretStorage.delete("apiKey"),
         this.secretStorage.delete("secretKey"),
      ]);
   }

   /** 根据配置项类型和当前存储模式选择实际读取位置。 */
   private async get(name: ConfigurationName): Promise<string> {
      if (credentialNames.has(name) && this.getCredentialStorage() === "secretStorage") {
         return (await this.secretStorage.get(name))?.trim() ?? "";
      }

      return this.getSelect(name);
   }

   /** 将未知或无效的存储模式安全回退为默认的明文设置。 */
   private getCredentialStorage(): CredentialStorage {
      return this.getSelect("credentialStorage") === "secretStorage" ? "secretStorage" : "settings";
   }

   /** 所有普通设置统一写入用户级配置，避免凭据落入工作区文件。 */
   private async updateSetting(name: ConfigurationName, value: string): Promise<void> {
      await vscode.workspace.getConfiguration(configurationSection).update(name, value, vscode.ConfigurationTarget.Global);
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
