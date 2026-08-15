import { createHash } from "node:crypto";
import type * as vscode from "vscode";
import type { TranslationMode } from "../@types/TranslationConfiguration";

export const defaultTranslationCacheCount = 300;

const cacheStorageKey = "floatingTranslation.translationCache";
const cacheVersion = 1;

export interface TranslationCacheContext {
   readonly contentKey: string;
   readonly translationTool: string;
   readonly translationMode: TranslationMode;
   readonly sourceLanguage: string;
   readonly targetLanguage: string;
   readonly openAiCompatibleEndpoint: string;
   readonly openAiCompatibleModel: string;
   readonly customPrompt: string;
}

interface StoredTranslationCache {
   readonly version: number;
   readonly entries: Record<string, string>;
   readonly order: readonly string[];
}

interface TranslationCacheState {
   entries: Record<string, string>;
   order: string[];
}

/** 根据原始 Hover 摘要和影响译文的配置生成不含原文的缓存键。 */
export function createTranslationCacheKey(context: TranslationCacheContext): string {
   const keyInput = {
      version: cacheVersion,
      contentKey: context.contentKey,
      translationTool: context.translationTool,
      translationMode: context.translationMode,
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
      openAiCompatibleEndpoint: context.openAiCompatibleEndpoint,
      openAiCompatibleModel: context.openAiCompatibleModel,
      customPrompt: context.customPrompt,
   };

   return createHash("sha256").update(JSON.stringify(keyInput), "utf8").digest("hex");
}

/** 将最终译文保存在当前工作区，并按最近使用顺序淘汰旧条目。 */
export class TranslationCache {
   private state: TranslationCacheState;
   private writeQueue: Promise<boolean> = Promise.resolve(true);

   public constructor(
      private readonly memento: vscode.Memento,
      private readonly getMaxCacheCount: () => number,
      private readonly onPersistenceError: (error: unknown) => void = () => undefined,
   ) {
      this.state = readCacheState(memento);
   }

   public async get(key: string): Promise<string | undefined> {
      let changed = this.trimToCapacity(this.readMaxCacheCount());
      const value = this.state.entries[key];

      if (value !== undefined) {
         changed = this.touch(key) || changed;
      }

      if (changed) {
         await this.persist();
      }

      return value;
   }

   public async set(key: string, translatedText: string): Promise<boolean> {
      this.state.entries[key] = translatedText;
      this.state.order = this.state.order.filter((entryKey) => entryKey !== key);
      this.state.order.push(key);
      this.trimToCapacity(this.readMaxCacheCount());

      return this.persist();
   }

   public async delete(key: string): Promise<boolean> {
      if (!Object.prototype.hasOwnProperty.call(this.state.entries, key)) {
         return true;
      }

      delete this.state.entries[key];
      this.state.order = this.state.order.filter((entryKey) => entryKey !== key);

      return this.persist();
   }

   public async trim(): Promise<boolean> {
      if (!this.trimToCapacity(this.readMaxCacheCount())) {
         return true;
      }

      return this.persist();
   }

   public async clear(): Promise<boolean> {
      this.state = createEmptyCacheState();

      return this.persist();
   }

   private touch(key: string): boolean {
      const index = this.state.order.indexOf(key);

      if (index === this.state.order.length - 1) {
         return false;
      }

      this.state.order.splice(index, 1);
      this.state.order.push(key);
      return true;
   }

   private trimToCapacity(maxCacheCount: number): boolean {
      let changed = false;

      while (this.state.order.length > maxCacheCount) {
         const oldestKey = this.state.order.shift();

         if (oldestKey === undefined) {
            break;
         }

         delete this.state.entries[oldestKey];
         changed = true;
      }

      return changed;
   }

   private readMaxCacheCount(): number {
      const maxCacheCount = this.getMaxCacheCount();

      return Number.isSafeInteger(maxCacheCount) && maxCacheCount > 0 ? maxCacheCount : defaultTranslationCacheCount;
   }

   private persist(): Promise<boolean> {
      const value: StoredTranslationCache | undefined =
         this.state.order.length === 0
            ? undefined
            : {
                 version: cacheVersion,
                 entries: { ...this.state.entries },
                 order: [...this.state.order],
              };

      const operation = this.writeQueue
         .catch(() => true)
         .then(() => this.memento.update(cacheStorageKey, value))
         .then(
            () => true,
            (error: unknown) => {
               try {
                  this.onPersistenceError(error);
               } catch {
                  // Persistence diagnostics must never break Hover or translation flows.
               }

               return false;
            },
         );

      this.writeQueue = operation;
      return operation;
   }
}

function readCacheState(memento: vscode.Memento): TranslationCacheState {
   const stored = memento.get<unknown>(cacheStorageKey);

   if (!isRecord(stored) || stored.version !== cacheVersion || !isRecord(stored.entries) || !Array.isArray(stored.order)) {
      return createEmptyCacheState();
   }

   const entries: Record<string, string> = {};

   for (const [key, value] of Object.entries(stored.entries)) {
      if (typeof value === "string") {
         entries[key] = value;
      }
   }

   const order: string[] = [];

   for (const key of stored.order) {
      if (typeof key === "string" && Object.prototype.hasOwnProperty.call(entries, key) && !order.includes(key)) {
         order.push(key);
      }
   }

   for (const key of Object.keys(entries)) {
      if (!order.includes(key)) {
         order.push(key);
      }
   }

   return { entries, order };
}

function createEmptyCacheState(): TranslationCacheState {
   return { entries: {}, order: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
   return typeof value === "object" && value !== null && !Array.isArray(value);
}
