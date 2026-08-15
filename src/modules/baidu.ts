import { createHash, randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { TranslationProvider } from "../@types/TranslationProvider";
import type { BaiduTranslationOptions } from "../@types/TranslationProviderOptions";
import { getConcurrentRequestCount, mapWithConcurrency, normalizePositiveInteger } from "../Utils/ConcurrentRequestExecutor";

/** 百度通用文本翻译 API 固定地址。 */
const endpoint = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const requestTimeoutMilliseconds = 15_000;
const defaultConcurrency = 50;

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
export class BaiduTranslation implements TranslationProvider {
   public readonly serviceName = vscode.l10n.t("Baidu Translate");
   /** 控制排队任务和在途 HTTP 请求的终止信号。 */
   private readonly abortController = new AbortController();
   /** 归一化后的源语言代码。 */
   private readonly sourceLanguage: string;
   /** 归一化后的目标语言代码。 */
   private readonly targetLanguage: string;
   /** 去除首尾空白后的 APPID。 */
   private readonly appId: string;
   /** 去除首尾空白后的密钥。 */
   private readonly appKey: string;
   /** 每秒启动及同时进行的最大请求数。 */
   private readonly concurrency: number;

   /** 接收上层解析完成的配置，不在适配器内部读取编辑器设置。 */
   public constructor(
      options: BaiduTranslationOptions,
      private readonly fetchImplementation: typeof fetch = fetch,
   ) {
      this.sourceLanguage = this.toLanguageCode(options.sourceLanguage);
      this.targetLanguage = this.toLanguageCode(options.targetLanguage);
      this.appId = options.appId.trim();
      this.appKey = options.appKey.trim();
      this.concurrency = normalizePositiveInteger(options.concurrency, defaultConcurrency);
   }

   /** 根据本次文本片段数返回实际会启动的并发请求数。 */
   public getConcurrentRequestCount(textCount: number): number {
      return getConcurrentRequestCount(textCount, this.concurrency);
   }

   /** 停止调度后续请求并中止当前批次的在途 HTTP 请求。 */
   public terminate(): void {
      this.abortController.abort(new Error(vscode.l10n.t("The Baidu Translate request was terminated")));
   }

   /** 使用有限速率和并发翻译多段非空文本，返回结果顺序与输入文本顺序一致。 */
   public async invoke(texts: readonly string[]): Promise<string[]> {
      if (!this.appId || !this.appKey) {
         throw new Error(vscode.l10n.t("Configure the Baidu Translate APPID and secret key first"));
      }

      return mapWithConcurrency(texts, this.concurrency, (text, signal) => this.translate(text, signal), {
         requestsPerSecond: this.concurrency,
         signal: this.abortController.signal,
      });
   }

   /** 为单段文本生成独立签名并发送表单请求。 */
   private async translate(text: string, signal: AbortSignal): Promise<string> {
      const sourceText = text.trim();

      if (!sourceText) {
         throw new Error(vscode.l10n.t("Text submitted to Baidu Translate cannot be empty"));
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
         response = await this.fetchImplementation(endpoint, {
            method: "POST",
            headers: {
               "Content-Type": "application/x-www-form-urlencoded",
            },
            body: requestBody,
            signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMilliseconds)]),
         });
      } catch (error) {
         const message = error instanceof Error ? error.message : String(error);

         throw new Error(vscode.l10n.t("Baidu Translate request failed: {message}", { message }), { cause: error });
      }

      if (!response.ok) {
         throw new Error(
            vscode.l10n.t("Baidu Translate request failed with HTTP status: {status}", {
               status: response.status,
            }),
         );
      }

      const responseBody = (await response.json()) as BaiduTranslationResponse;

      if (responseBody.error_code !== undefined) {
         throw new Error(
            vscode.l10n.t("Baidu Translate request failed with code {code}: {message}", {
               code: responseBody.error_code,
               message: responseBody.error_msg ?? vscode.l10n.t("unknown"),
            }),
         );
      }

      const translatedResults = responseBody.trans_result;

      if (!translatedResults?.length || translatedResults.some((result) => typeof result.dst !== "string")) {
         throw new Error(vscode.l10n.t("The Baidu Translate response did not contain a valid translation"));
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
