import * as assert from "node:assert/strict";
import type * as vscode from "vscode";
import { createTranslationCacheKey, TranslationCache } from "../Utils/TranslationCache";

suite("TranslationCache", () => {
   test("缓存键隔离影响译文的配置且不包含原文", () => {
      const context = {
         contentKey: "content-key",
         translationTool: "aliyun",
         translationMode: "localPlaceholders",
         sourceLanguage: "en",
         targetLanguage: "zh-cn",
         openAiCompatibleEndpoint: "",
         openAiCompatibleModel: "",
         customPrompt: "",
      } as const;
      const key = createTranslationCacheKey(context);

      assert.match(key, /^[0-9a-f]{64}$/);
      assert.notEqual(key, createTranslationCacheKey({ ...context, targetLanguage: "ja" }));
      assert.doesNotMatch(key, /content-key/);
   });

   test("跨缓存实例恢复工作区状态并按最近使用顺序淘汰", async () => {
      const memento = new InMemoryMemento();
      const cache = new TranslationCache(memento, () => 2);

      assert.equal(await cache.set("first", "第一条最终译文"), true);
      assert.equal(await cache.set("second", "第二条最终译文"), true);
      assert.equal(await cache.get("first"), "第一条最终译文");
      assert.equal(await cache.set("third", "第三条最终译文"), true);

      const restoredCache = new TranslationCache(memento, () => 2);

      assert.equal(await restoredCache.get("first"), "第一条最终译文");
      assert.equal(await restoredCache.get("second"), undefined);
      assert.equal(await restoredCache.get("third"), "第三条最终译文");
   });

   test("缩小容量时立即裁剪最旧条目", async () => {
      const memento = new InMemoryMemento();
      let maxCacheCount = 3;
      const cache = new TranslationCache(memento, () => maxCacheCount);

      await cache.set("first", "第一条");
      await cache.set("second", "第二条");
      await cache.set("third", "第三条");

      maxCacheCount = 1;
      assert.equal(await cache.trim(), true);
      assert.equal(await cache.get("first"), undefined);
      assert.equal(await cache.get("second"), undefined);
      assert.equal(await cache.get("third"), "第三条");
   });

   test("删除指定缓存会保留其他条目并更新持久化状态", async () => {
      const memento = new InMemoryMemento();
      const cache = new TranslationCache(memento, () => 2);

      await cache.set("refresh", "待刷新的译文");
      await cache.set("other", "其他译文");

      assert.equal(await cache.delete("refresh"), true);
      assert.equal(await cache.get("refresh"), undefined);
      assert.equal(await cache.get("other"), "其他译文");

      const restoredCache = new TranslationCache(memento, () => 2);

      assert.equal(await restoredCache.get("refresh"), undefined);
      assert.equal(await restoredCache.get("other"), "其他译文");
   });

   test("清空缓存会删除持久化状态", async () => {
      const memento = new InMemoryMemento();
      const cache = new TranslationCache(memento, () => 2);

      await cache.set("key", "最终译文");
      assert.equal(await cache.clear(), true);

      const restoredCache = new TranslationCache(memento, () => 2);

      assert.equal(await restoredCache.get("key"), undefined);
      assert.deepEqual(memento.keys(), []);
   });

   test("持久化失败时保留内存行为并返回失败状态", async () => {
      let persistenceErrors = 0;
      const cache = new TranslationCache(
         new FailingMemento(),
         () => 2,
         () => {
            persistenceErrors += 1;
         },
      );

      assert.equal(await cache.set("key", "最终译文"), false);
      assert.equal(await cache.get("key"), "最终译文");
      assert.equal(persistenceErrors, 1);
   });
});

class InMemoryMemento implements vscode.Memento {
   private readonly values = new Map<string, unknown>();

   public get<T>(key: string): T | undefined;
   public get<T>(key: string, defaultValue: T): T;
   public get<T>(key: string, defaultValue?: T): T | undefined {
      const value = this.values.get(key);

      return (value === undefined ? defaultValue : value) as T | undefined;
   }

   public keys(): readonly string[] {
      return [...this.values.keys()];
   }

   public update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) {
         this.values.delete(key);
      } else {
         this.values.set(key, value);
      }

      return Promise.resolve();
   }
}

class FailingMemento extends InMemoryMemento {
   public override update(_key: string, _value: unknown): Thenable<void> {
      return Promise.reject(new Error("模拟持久化失败"));
   }
}
