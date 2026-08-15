import AlimtClient, { TranslateGeneralRequest } from "@alicloud/alimt20181012";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import * as vscode from "vscode";
import type { TranslationProvider } from "../@types/TranslationProvider";
import type { AliyunTranslationOptions } from "../@types/TranslationProviderOptions";
import { getConcurrentRequestCount, mapWithConcurrency, normalizePositiveInteger } from "../Utils/ConcurrentRequestExecutor";

/** 阿里云机器翻译通用版固定服务端点。 */
const endpoint = "mt.cn-hangzhou.aliyuncs.com";
const defaultConcurrency = 50;

/** 调用阿里云机器翻译通用版的服务适配器。 */
export class AliyunTranslation implements TranslationProvider {
   public readonly serviceName = vscode.l10n.t("Alibaba Cloud Translation");
   /** 控制排队任务及适配器返回结果的终止信号。 */
   private readonly abortController = new AbortController();
   /** 归一化后的源语言代码。 */
   private readonly sourceLanguage: string;
   /** 归一化后的目标语言代码。 */
   private readonly targetLanguage: string;
   /** 去除首尾空白后的 AccessKey ID。 */
   private readonly accessKeyId: string;
   /** 去除首尾空白后的 AccessKey Secret。 */
   private readonly accessKeySecret: string;
   /** 每秒启动及同时进行的最大请求数。 */
   private readonly concurrency: number;

   /** 接收上层解析完成的配置，不在适配器内部读取编辑器设置。 */
   public constructor(options: AliyunTranslationOptions) {
      this.sourceLanguage = this.toLanguageCode(options.sourceLanguage);
      this.targetLanguage = this.toLanguageCode(options.targetLanguage);
      this.accessKeyId = options.accessKeyId.trim();
      this.accessKeySecret = options.accessKeySecret.trim();
      this.concurrency = normalizePositiveInteger(options.concurrency, defaultConcurrency);
   }

   /** 根据本次文本片段数返回实际会启动的并发请求数。 */
   public getConcurrentRequestCount(textCount: number): number {
      return getConcurrentRequestCount(textCount, this.concurrency);
   }

   /** 停止调度后续请求，并使当前批量调用停止等待 SDK 在途请求。 */
   public terminate(): void {
      this.abortController.abort(new Error(vscode.l10n.t("The Alibaba Cloud Translation request was terminated")));
   }

   /** 使用有限速率和并发翻译多段非空文本，返回结果顺序与输入文本顺序一致。 */
   public async invoke(texts: readonly string[]): Promise<string[]> {
      if (!this.accessKeyId || !this.accessKeySecret) {
         throw new Error(vscode.l10n.t("Configure the Alibaba Cloud AccessKey ID and AccessKey Secret first"));
      }

      const client = new AlimtClient(
         new $OpenApiUtil.Config({
            accessKeyId: this.accessKeyId,
            accessKeySecret: this.accessKeySecret,
            endpoint,
         }),
      );

      return mapWithConcurrency(
         texts,
         this.concurrency,
         async (text) => {
            const sourceText = text.trim();

            if (!sourceText) {
               throw new Error(vscode.l10n.t("Text submitted to Alibaba Cloud Translation cannot be empty"));
            }

            const request = new TranslateGeneralRequest({
               formatType: "text",
               scene: "general",
               sourceLanguage: this.sourceLanguage,
               sourceText,
               targetLanguage: this.targetLanguage,
            });
            const response = await client.translateGeneral(request);
            const responseBody = response.body;

            // SDK 同时暴露 HTTP 状态和业务状态，两层都成功才接受译文。
            if (response.statusCode !== 200) {
               throw new Error(
                  vscode.l10n.t("Alibaba Cloud Translation request failed with HTTP status: {status}", {
                     status: response.statusCode ?? vscode.l10n.t("unknown"),
                  }),
               );
            }

            if (responseBody?.code !== 200) {
               throw new Error(
                  vscode.l10n.t("Alibaba Cloud Translation request failed with code {code}: {message}", {
                     code: responseBody?.code ?? vscode.l10n.t("unknown"),
                     message: responseBody?.message ?? vscode.l10n.t("unknown"),
                  }),
               );
            }

            const translatedText = responseBody.data?.translated;

            if (!translatedText) {
               throw new Error(vscode.l10n.t("The Alibaba Cloud Translation response did not contain a translation"));
            }

            return translatedText;
         },
         {
            requestsPerSecond: this.concurrency,
            signal: this.abortController.signal,
         },
      );
   }

   /** 将 VS Code/BCP 47 语言标记归一化为阿里云当前使用的语言代码。 */
   private toLanguageCode(language: string): string {
      if (!language || language === "zh-tw") {
         // 当前实现不区分中文地区变体，统一交给阿里云的 zh 代码。
         return "zh";
      }

      return /^zh(?:-|$)/i.test(language) ? "zh" : language;
   }
}
