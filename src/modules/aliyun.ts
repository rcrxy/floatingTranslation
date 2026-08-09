import AlimtClient, { TranslateGeneralRequest } from "@alicloud/alimt20181012";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import * as vscode from "vscode";

const endpoint = "mt.cn-hangzhou.aliyuncs.com";

export class AliyunTranslation {
    sourceLanguage: string;
    targetLanguage: string;

    constructor(sourceLanguage: string, targetLanguage: string) {
        this.sourceLanguage = this.toLanguageCode(sourceLanguage);
        this.targetLanguage = this.toLanguageCode(targetLanguage);
    }

    async invoke(text: string): Promise<string> {
        const sourceText = text.trim();

        if (!sourceText) {
            throw new Error("阿里云翻译的待翻译文本不能为空");
        }

        const configuration = vscode.workspace.getConfiguration("floatingTranslation");
        const accessKeyId = configuration.get<string>("apiKey", "").trim();
        const accessKeySecret = configuration.get<string>("secretKey", "").trim();

        if (!accessKeyId || !accessKeySecret) {
            throw new Error("请先配置阿里云 AccessKey ID 和 AccessKey Secret");
        }

        const client = new AlimtClient(
            new $OpenApiUtil.Config({
                accessKeyId,
                accessKeySecret,
                endpoint,
            }),
        );
        const request = new TranslateGeneralRequest({
            formatType: "text",
            scene: "general",
            sourceLanguage: this.sourceLanguage,
            sourceText,
            targetLanguage: this.targetLanguage,
        });
        const response = await client.translateGeneral(request);
        const responseBody = response.body;

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
    }

    toLanguageCode(language: string): string {
        if (!language || language === "zh-tw") {
            return "zh";
        }

        return /^zh(?:-|$)/i.test(language) ? "zh" : language;
    }
}
