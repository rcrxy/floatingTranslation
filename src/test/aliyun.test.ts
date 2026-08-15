import * as assert from "node:assert/strict";
import { AliyunTranslation } from "../modules/aliyun";

suite("AliyunTranslation", () => {
   test("terminate 停止尚未开始的请求", async () => {
      const service = new AliyunTranslation({
         sourceLanguage: "en",
         targetLanguage: "zh",
         accessKeyId: "test-access-key-id",
         accessKeySecret: "test-access-key-secret",
         concurrency: 1,
      });

      service.terminate();

      await assert.rejects(service.invoke(["Text"]), /The Alibaba Cloud Translation request was terminated/);
   });
});
