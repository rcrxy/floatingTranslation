import * as assert from "node:assert/strict";
import { BaiduTranslation } from "../modules/baidu";

suite("BaiduTranslation", () => {
   test("terminate 中止在途请求并停止后续调度", async () => {
      const startedTexts: string[] = [];
      let requestSignal: AbortSignal | undefined;
      let markRequestStarted: () => void = () => undefined;
      const requestStarted = new Promise<void>((resolve) => {
         markRequestStarted = resolve;
      });
      const fetchImplementation = (async (_input: string | URL | Request, init?: RequestInit) => {
         const requestBody = new URLSearchParams(String(init?.body));

         startedTexts.push(requestBody.get("q") ?? "");
         requestSignal = init?.signal ?? undefined;
         markRequestStarted();

         return new Promise<Response>((_resolve, reject) => {
            requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
         });
      }) as typeof fetch;
      const service = new BaiduTranslation(
         {
            sourceLanguage: "en",
            targetLanguage: "zh",
            appId: "test-app-id",
            appKey: "test-app-key",
            concurrency: 1,
         },
         fetchImplementation,
      );
      const resultPromise = service.invoke(["First.", "Second."]);

      await requestStarted;
      service.terminate();

      await assert.rejects(resultPromise, /百度翻译请求已终止/);
      assert.deepEqual(startedTexts, ["First."]);
      assert.equal(requestSignal?.aborted, true);
   });
});
