import AlimtClient, { TranslateGeneralRequest } from "@alicloud/alimt20181012";
import { $OpenApiUtil } from "@alicloud/openapi-core";

/** 阿里云机器翻译通用版固定服务端点。 */
const endpoint = "mt.cn-hangzhou.aliyuncs.com";

/** 创建阿里云翻译适配器所需的完整、与 VS Code 无关的配置。 */
export interface AliyunTranslationOptions {
   /** 阿里云支持的源语言代码。 */
   readonly sourceLanguage: string;
   /** 阿里云支持的目标语言代码。 */
   readonly targetLanguage: string;
   /** 阿里云 AccessKey ID。 */
   readonly accessKeyId: string;
   /** 阿里云 AccessKey Secret。 */
   readonly accessKeySecret: string;
}

/** 调用阿里云机器翻译通用版的服务适配器。 */
export class AliyunTranslation {
   /** 归一化后的源语言代码。 */
   private readonly sourceLanguage: string;
   /** 归一化后的目标语言代码。 */
   private readonly targetLanguage: string;
   /** 去除首尾空白后的 AccessKey ID。 */
   private readonly accessKeyId: string;
   /** 去除首尾空白后的 AccessKey Secret。 */
   private readonly accessKeySecret: string;

   /** 接收上层解析完成的配置，不在适配器内部读取编辑器设置。 */
   public constructor(options: AliyunTranslationOptions) {
      this.sourceLanguage = this.toLanguageCode(options.sourceLanguage);
      this.targetLanguage = this.toLanguageCode(options.targetLanguage);
      this.accessKeyId = options.accessKeyId.trim();
      this.accessKeySecret = options.accessKeySecret.trim();
   }

   /** 并发翻译多段非空文本，返回结果顺序与输入文本顺序一致。 */
   public async invoke(texts: readonly string[]): Promise<string[]> {
      if (!this.accessKeyId || !this.accessKeySecret) {
         throw new Error("请先配置阿里云 AccessKey ID 和 AccessKey Secret");
      }

      const client = new AlimtClient(
         new $OpenApiUtil.Config({
            accessKeyId: this.accessKeyId,
            accessKeySecret: this.accessKeySecret,
            endpoint,
         }),
      );

      return Promise.all(
         texts.map(async (text) => {
            const sourceText = text.trim();

            if (!sourceText) {
               throw new Error("阿里云翻译的待翻译文本不能为空");
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
               throw new Error(`阿里云翻译请求失败，HTTP 状态码：${response.statusCode ?? "未知"}`);
            }

            if (responseBody?.code !== 200) {
               throw new Error(
                  `阿里云翻译请求失败，错误码：${responseBody?.code ?? "未知"}，错误信息：${responseBody?.message ?? "未知"}`,
               );
            }

            const translatedText = responseBody.data?.translated;

            if (!translatedText) {
               throw new Error("阿里云翻译响应中未包含译文");
            }

            return translatedText;
         }),
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
