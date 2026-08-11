import * as assert from "node:assert/strict";
import {translateContents} from "../AggregationTranslation";
import type {TranslatableContent, TranslationPlaceholder} from "../Utils/TranslatableContentAnalyzer";

suite("AggregationTranslation", () => {
   test("占位符不发送给翻译服务并按原顺序恢复", async () => {
      const placeholders = new Map<string, TranslationPlaceholder>([
         ["param", {token: "{{0761565856:0001}}", source: "*@param*"}],
         ["command", {token: "{{0761565856:0000}}", source: "`command`"}],
         ["callbackParam", {token: "{{0761565856:0003}}", source: "*@param*"}],
         ["callback", {token: "{{0761565856:0002}}", source: "`callback`"}],
         ["thisArgParam", {token: "{{0761565856:0006}}", source: "*@param*"}],
         ["thisArg", {token: "{{0761565856:0004}}", source: "`thisArg`"}],
         ["this", {token: "{{0761565856:0005}}", source: "`this`"}],
         ["returns", {token: "{{0761565856:0007}}", source: "*@returns*"}],
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

      const translatedText = await translateContents(contents, async (sourceTexts) => {
         requestedTexts.push(...sourceTexts);

         // 模拟百度曾出现的行为：若收到花括号占位符，就会破坏其格式。
         return sourceTexts.map((sourceText) => sourceText.replace(/\{\{(\d+):(\d+)\}\}/g, "{{$1 $2}"));
      });

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

   test("没有占位符时保持整段批量翻译", async () => {
      const contents: readonly TranslatableContent[] = [
         {
            sourceText: "First paragraph.\n\nSecond paragraph.",
            value: [createValue("First paragraph."), createValue("Second paragraph.")],
         },
      ];
      let requestedTexts: readonly string[] = [];

      const translatedText = await translateContents(contents, async (sourceTexts) => {
         requestedTexts = sourceTexts;
         return ["第一段。", "第二段。"];
      });

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
