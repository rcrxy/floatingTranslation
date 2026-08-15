import * as assert from "node:assert/strict";
import type { FloatingTranslationConfiguration } from "../@types/TranslationConfiguration";
import type { TranslatableContent, TranslationPlaceholder } from "../@types/TranslatableContent";
import { AggregationTranslation, hasTranslatableContent, translateContents } from "../AggregationTranslation";
import type { ConfigTool } from "../Utils/ConfigTool";

suite("AggregationTranslation", () => {
   test("配置读取完成前允许上层终止翻译任务", async () => {
      let resolveConfiguration: (configuration: FloatingTranslationConfiguration) => void = () => undefined;
      const configurationPromise = new Promise<FloatingTranslationConfiguration>((resolve) => {
         resolveConfiguration = resolve;
      });
      const configTool = {
         getAll: () => configurationPromise,
      } as ConfigTool;
      const task = AggregationTranslation([{ sourceText: "Text", value: [createValue("Text")] }], configTool);

      task.terminate();
      resolveConfiguration({
         translationTool: "baidu",
         translationMode: "fullText",
         credentialStorage: "settings",
         aliyunAccessKeyId: "",
         aliyunAccessKeySecret: "",
         baiduAppId: "test-app-id",
         baiduAppKey: "test-app-key",
         QPS: 1,
         openAiCompatibleEndpoint: "",
         openAiCompatibleApiKey: "",
         openAiCompatibleModel: "",
         sourceLanguage: "en",
         targetLanguage: "zh",
         customPrompt: "",
      });

      await assert.rejects(task.promise, /翻译请求已终止/);
   });

   test("本地占位符保护不发送 token 并按原顺序恢复", async () => {
      const placeholders = new Map<string, TranslationPlaceholder>([
         ["param", { token: "{{0761565856:0001}}", source: "*@param*" }],
         ["command", { token: "{{0761565856:0000}}", source: "`command`" }],
         ["callbackParam", { token: "{{0761565856:0003}}", source: "*@param*" }],
         ["callback", { token: "{{0761565856:0002}}", source: "`callback`" }],
         ["thisArgParam", { token: "{{0761565856:0006}}", source: "*@param*" }],
         ["thisArg", { token: "{{0761565856:0004}}", source: "`thisArg`" }],
         ["this", { token: "{{0761565856:0005}}", source: "`this`" }],
         ["returns", { token: "{{0761565856:0007}}", source: "*@returns*" }],
      ]);
      const values = [
         createValue(
            `${token("param")} ${token("command")} — A unique identifier for the command.`,
            placeholder("param"),
            placeholder("command"),
         ),
         createValue(
            `${token("callbackParam")} ${token("callback")} — A command handler function.`,
            placeholder("callbackParam"),
            placeholder("callback"),
         ),
         createValue(
            `${token("thisArgParam")} ${token("thisArg")} — The ${token("this")} context used when invoking the handler function.`,
            placeholder("thisArgParam"),
            placeholder("thisArg"),
            placeholder("this"),
         ),
         createValue(`${token("returns")} — Disposable which unregisters this command on disposal.`, placeholder("returns")),
      ];
      const contents: readonly TranslatableContent[] = [
         {
            sourceText: values.map((value) => value.text).join("\n\n"),
            value: values,
         },
      ];
      const requestedTexts: string[] = [];

      const translatedText = await translateContents(
         contents,
         async (sourceTexts) => {
            requestedTexts.push(...sourceTexts);

            // 模拟百度曾出现的行为：若收到花括号占位符，就会破坏其格式。
            return sourceTexts.map((sourceText) => sourceText.replace(/\{\{(\d+):(\d+)\}\}/g, "{{$1 $2}"));
         },
         "localPlaceholders",
      );

      assert.ok(requestedTexts.length > 0);
      assert.ok(requestedTexts.every((sourceText) => !sourceText.includes("{{")));
      assert.ok(requestedTexts.every((sourceText) => !sourceText.includes("}}")));
      assert.match(translatedText, /\*@param\* `command` — A unique identifier for the command\./);
      assert.match(translatedText, /\*@param\* `callback` — A command handler function\./);
      assert.match(translatedText, /\*@param\* `thisArg` — The `this` context used when invoking the handler function\./);
      assert.match(translatedText, /\*@returns\* — Disposable which unregisters this command on disposal\./);
      assert.doesNotMatch(translatedText, /\{\{\d{10}:\d{4,}\}\}/);

      function placeholder(name: string): TranslationPlaceholder {
         const value = placeholders.get(name);

         assert.ok(value);
         return value;
      }

      function token(name: string): string {
         return placeholder(name).token;
      }
   });

   test("平台回传占位符模式发送 token 并在返回后恢复", async () => {
      const token = "{{0761565856:0000}}";
      const contents: readonly TranslatableContent[] = [
         {
            sourceText: "The `command` identifier.",
            value: [createValue(`The ${token} identifier.`, { token, source: "`command`" })],
         },
      ];
      let requestedTexts: readonly string[] = [];

      const translatedText = await translateContents(
         contents,
         async (sourceTexts) => {
            requestedTexts = sourceTexts;
            return [`${token} 标识符。`];
         },
         "remotePlaceholders",
      );

      assert.deepEqual(requestedTexts, [`The ${token} identifier.`]);
      assert.equal(translatedText, "`command` 标识符。");
   });

   test("全文直译发送完整原始 Markdown", async () => {
      const sourceText = "Description.\n\n```ts\nconst value = 1;\n```";
      const contents: readonly TranslatableContent[] = [
         {
            sourceText,
            value: [createValue("Description.")],
         },
      ];
      let requestedTexts: readonly string[] = [];

      const translatedText = await translateContents(
         contents,
         async (sourceTexts) => {
            requestedTexts = sourceTexts;
            return ["完整译文"];
         },
         "fullText",
      );

      assert.deepEqual(requestedTexts, [sourceText]);
      assert.equal(translatedText, "完整译文");
      assert.equal(hasTranslatableContent(contents, "fullText"), true);
   });

   test("代码块保护只翻译围栏外正文并保持代码原位", async () => {
      const sourceText = "Before.\n\n```ts\nconst value = 1;\n```\n\nAfter.";
      const contents: readonly TranslatableContent[] = [
         {
            sourceText,
            value: [createValue("Before."), createValue("After.")],
         },
      ];
      let requestedTexts: readonly string[] = [];

      const translatedText = await translateContents(
         contents,
         async (sourceTexts) => {
            requestedTexts = sourceTexts;
            return ["之前。", "之后。"];
         },
         "codeBlocks",
      );

      assert.deepEqual(requestedTexts, ["Before.", "After."]);
      assert.equal(translatedText, "之前。\n\n```ts\nconst value = 1;\n```\n\n之后。");
      assert.equal(hasTranslatableContent(contents, "codeBlocks"), true);
      assert.equal(hasTranslatableContent([{ sourceText: "```ts\nconst value = 1;\n```", value: [] }], "codeBlocks"), false);
   });

   test("没有占位符时保持整段批量翻译", async () => {
      const contents: readonly TranslatableContent[] = [
         {
            sourceText: "First paragraph.\n\nSecond paragraph.",
            value: [createValue("First paragraph."), createValue("Second paragraph.")],
         },
      ];
      let requestedTexts: readonly string[] = [];

      const translatedText = await translateContents(
         contents,
         async (sourceTexts) => {
            requestedTexts = sourceTexts;
            return ["第一段。", "第二段。"];
         },
         "localPlaceholders",
      );

      assert.deepEqual(requestedTexts, ["First paragraph.", "Second paragraph."]);
      assert.equal(translatedText, "第一段。\n\n第二段。");
   });
});

function createValue(text: string, ...placeholders: TranslationPlaceholder[]) {
   return {
      text,
      isTranslatable: true,
      placeholders,
   } as const;
}
