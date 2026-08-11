import {createHash, randomBytes} from "node:crypto";

/** 百度通用文本翻译 API 固定地址。 */
const endpoint = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const requestTimeoutMilliseconds = 15_000;

/** 创建百度翻译适配器所需的完整、与 VS Code 无关的配置。 */
export interface BaiduTranslationOptions {
   /** 百度支持的源语言代码。 */
   readonly sourceLanguage: string;
   /** 百度支持的目标语言代码。 */
   readonly targetLanguage: string;
   /** 百度翻译开放平台 APPID。 */
   readonly appId: string;
   /** 百度翻译开放平台密钥。 */
   readonly appKey: string;
}

interface BaiduTranslationResult {
   readonly src?: string;
   readonly dst?: string;
}

interface BaiduTranslationResponse {
   readonly error_code?: string | number;
   readonly error_msg?: string;
   readonly trans_result?: readonly BaiduTranslationResult[];
}

/** 调用百度通用文本翻译 API 的服务适配器。 */
export class BaiduTranslation {
   /** 归一化后的源语言代码。 */
   private readonly sourceLanguage: string;
   /** 归一化后的目标语言代码。 */
   private readonly targetLanguage: string;
   /** 去除首尾空白后的 APPID。 */
   private readonly appId: string;
   /** 去除首尾空白后的密钥。 */
   private readonly appKey: string;

   /** 接收上层解析完成的配置，不在适配器内部读取编辑器设置。 */
   public constructor(options: BaiduTranslationOptions) {
      this.sourceLanguage = this.toLanguageCode(options.sourceLanguage);
      this.targetLanguage = this.toLanguageCode(options.targetLanguage);
      this.appId = options.appId.trim();
      this.appKey = options.appKey.trim();
   }

   /** 并发翻译多段非空文本，返回结果顺序与输入文本顺序一致。 */
   public async invoke(texts: readonly string[]): Promise<string[]> {
      if (!this.appId || !this.appKey) {
         throw new Error("请先配置百度翻译 APPID 和密钥");
      }

      return Promise.all(texts.map((text) => this.translate(text)));
   }

   /** 为单段文本生成独立签名并发送表单请求。 */
   private async translate(text: string): Promise<string> {
      const sourceText = text.trim();

      if (!sourceText) {
         throw new Error("百度翻译的待翻译文本不能为空");
      }

      const salt = randomBytes(16).toString("hex");
      const sign = createHash("md5").update(`${this.appId}${sourceText}${salt}${this.appKey}`, "utf8").digest("hex");
      const requestBody = new URLSearchParams({
         q: sourceText,
         from: this.sourceLanguage,
         to: this.targetLanguage,
         appid: this.appId,
         salt,
         sign,
      });

      let response: Response;

      try {
         response = await fetch(endpoint, {
            method: "POST",
            headers: {
               "Content-Type": "application/x-www-form-urlencoded",
            },
            body: requestBody,
            signal: AbortSignal.timeout(requestTimeoutMilliseconds),
         });
      } catch (error) {
         const message = error instanceof Error ? error.message : String(error);

         throw new Error(`百度翻译请求失败：${message}`, {cause: error});
      }

      if (!response.ok) {
         throw new Error(`百度翻译请求失败，HTTP 状态码：${response.status}`);
      }

      const responseBody = (await response.json()) as BaiduTranslationResponse;

      if (responseBody.error_code !== undefined) {
         throw new Error(`百度翻译请求失败，错误码：${responseBody.error_code}，错误信息：${responseBody.error_msg ?? "未知"}`);
      }

      const translatedResults = responseBody.trans_result;

      if (!translatedResults?.length || translatedResults.some((result) => typeof result.dst !== "string")) {
         throw new Error("百度翻译响应中未包含有效译文");
      }

      return translatedResults.map((result) => result.dst).join("\n");
   }

   /** 将 VS Code/BCP 47 语言标记归一化为百度当前使用的语言代码。 */
   private toLanguageCode(language: string): string {
      const normalizedLanguage = language.trim().toLowerCase();

      if (/^zh-(?:tw|hk|mo)$/.test(normalizedLanguage)) {
         return "cht";
      }

      if (/^zh(?:-|$)/.test(normalizedLanguage)) {
         return "zh";
      }

      const languageCode = normalizedLanguage.split("-", 1)[0];
      const languageCodeMap: Readonly<Record<string, string>> = {
         ar: "ara",
         bg: "bul",
         da: "dan",
         es: "spa",
         et: "est",
         fi: "fin",
         fr: "fra",
         he: "heb",
         ja: "jp",
         ko: "kor",
         ms: "may",
         no: "nor",
         ro: "rom",
         sl: "slo",
         sv: "swe",
         uk: "ukr",
         vi: "vie",
      };

      return languageCodeMap[languageCode] ?? languageCode;
   }
}
