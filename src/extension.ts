import * as vscode from "vscode";
import type { TranslationMode } from "./@types/TranslationConfiguration";
import type { TranslatableContent } from "./@types/TranslatableContent";
import { ConfigTool, normalizeTranslationMode } from "./Utils/ConfigTool";
import { output, outputChannelName } from "./Utils/output";
import { TranslatableContentAnalyzer } from "./Utils/TranslatableContentAnalyzer";
import { AggregationTranslation, hasTranslatableContent } from "./AggregationTranslation";
import { createTranslationCacheKey, TranslationCache } from "./Utils/TranslationCache";

// executeHoverProvider 会回调本扩展的 Provider，用位置键阻断同一次递归调用。
const running = new Set<string>();

/** 最近一次由自然 Hover 捕获且可能用于翻译的上下文。 */
interface CapturedHover {
   /** 文档、版本和位置组成的 Hover 身份。 */
   readonly key: string;
   /** 原始 Hover 内容摘要，用于区分内容相同位置上的不同结果。 */
   readonly contentKey: string;
   /** 捕获时的文档 URI。 */
   readonly documentUri: string;
   /** 捕获时的文档版本，文档修改后缓存立即失效。 */
   readonly documentVersion: number;
   /** 自然 Hover 出现的位置。 */
   readonly position: vscode.Position;
   /** 已拆分并标记可翻译片段的 Hover 内容。 */
   readonly contents: readonly TranslatableContent[];
}

/** 将翻译 Promise 的成功和失败统一为可等待的结果值。 */
type TranslationOutcome =
   | {
        readonly kind: "success";
        readonly translatedText: string;
     }
   | {
        readonly kind: "unchanged";
     }
   | {
        readonly kind: "error";
        readonly error: unknown;
     };

/** 正在等待翻译完成的状态。 */
interface LoadingTranslationState {
   readonly kind: "loading";
   /** 单调递增的请求标识，用于忽略过期回调。 */
   readonly requestId: number;
   /** 本次翻译所属的 Hover 位置键。 */
   readonly key: string;
   /** 本次翻译所属的 Hover 内容摘要。 */
   readonly contentKey: string;
   /** 创建任务时的翻译配置修订号。 */
   readonly configurationRevision: number;
   /** Provider 和命令处理器共享的翻译任务。 */
   readonly promise: Promise<TranslationOutcome>;
   /** 终止适配器的排队任务和可取消的在途请求。 */
   readonly terminate: () => void;
}

/** Hover 翻译在空闲、加载和已翻译之间转换的有限状态。 */
type TranslationState =
   | {
        readonly kind: "idle";
     }
   | LoadingTranslationState
   | {
        readonly kind: "translated";
        readonly requestId: number;
        readonly key: string;
        readonly contentKey: string;
        readonly configurationRevision: number;
        readonly translatedText: string;
     };

// 状态保存在扩展宿主进程内，仅覆盖当前 VS Code 窗口的最近一次 Hover。
let capturedHover: CapturedHover | undefined;
let translationState: TranslationState = { kind: "idle" };
let nextRequestId = 0;
let translationConfigurationRevision = 0;

/** 注册 Hover Provider、翻译命令和凭据管理命令。 */
export function activate(context: vscode.ExtensionContext): void {
   const configTool = new ConfigTool(context.secrets);
   const translationCache = new TranslationCache(
      context.workspaceState,
      () => configTool.getMaxCacheCount(),
      (error) =>
         output.appendLine(
            vscode.l10n.t("Cache persistence failed: {error}", {
               error: formatError(error),
            }),
         ),
   );

   void translationCache.trim().catch((error) => {
      output.appendLine(
         vscode.l10n.t("Failed to trim translation cache: {error}", {
            error: formatError(error),
         }),
      );
   });

   // Provider 不替换自然 Hover，只负责观察原始 Provider 的结果并在翻译阶段追加译文。
   const provider = vscode.languages.registerHoverProvider(
      { scheme: "*" },
      {
         async provideHover(document, position, token): Promise<vscode.Hover | undefined> {
            const key = createHoverKey(document, position);

            // 内部 executeHoverProvider 会再次调用当前 Provider，命中后必须立即退出。
            if (running.has(key)) {
               return undefined;
            }

            running.add(key);

            try {
               // 汇总其他已注册 Provider 的结果；running 会排除本 Provider 自身。
               const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                  "vscode.executeHoverProvider",
                  document.uri,
                  position,
               );

               if (token.isCancellationRequested) {
                  return undefined;
               }

               const analysis = new TranslatableContentAnalyzer(hovers).invoke();
               const translationMode = normalizeTranslationMode(configTool.getSelect("translationMode"));
               const cacheKey = createCurrentTranslationCacheKey(analysis.key, configTool, translationMode);

               const captured: CapturedHover = {
                  key,
                  contentKey: analysis.key,
                  documentUri: document.uri.toString(),
                  documentVersion: document.version,
                  position,
                  contents: analysis.contents,
               };
               capturedHover = captured;

               const state = translationState;

               if (isSameTranslationRequest(state, captured)) {
                  if (state.kind === "loading") {
                     return providePendingTranslationHover(state, token);
                  }

                  if (state.kind === "translated") {
                     return createTranslationHover(state.translatedText);
                  }
               }

               if (state.kind === "translated") {
                  // 位置、内容或配置变化后不再注入旧译文。
                  translationState = { kind: "idle" };
               }

               if (!hasTranslatableContent(captured.contents, translationMode)) {
                  return undefined;
               }

               const cachedText = await translationCache.get(cacheKey);

               if (token.isCancellationRequested) {
                  return undefined;
               }

               const latestState = translationState;

               if (isSameTranslationRequest(latestState, captured)) {
                  if (latestState.kind === "loading") {
                     return providePendingTranslationHover(latestState, token);
                  }

                  if (latestState.kind === "translated") {
                     return createTranslationHover(latestState.translatedText);
                  }
               }

               if (cachedText !== undefined) {
                  if (translationState.kind === "loading") {
                     translationState.terminate();
                  }

                  translationState = {
                     kind: "translated",
                     requestId: ++nextRequestId,
                     key,
                     contentKey: captured.contentKey,
                     configurationRevision: translationConfigurationRevision,
                     translatedText: cachedText,
                  };

                  return createTranslationHover(cachedText);
               }

               // 未命中时返回 undefined，让自然 Hover 仍由原始语言服务负责显示。
               return undefined;
            } catch (error) {
               capturedHover = undefined;

               output.appendLine(
                  vscode.l10n.t("Failed to read Hover: {error}", {
                     error: formatError(error),
                  }),
               );

               return undefined;
            } finally {
               running.delete(key);
            }
         },
      },
   );

   // 用户主动触发后，只翻译最近一次仍与当前文档版本匹配的 Hover。
   const triggerCommand = vscode.commands.registerCommand("floatingTranslation.trigger", async () => {
      const editor = vscode.window.activeTextEditor;
      const captured = capturedHover;
      const translationMode = normalizeTranslationMode(configTool.getSelect("translationMode"));

      if (!editor) return;

      if (!captured || !isCapturedHoverValid(editor, captured, translationMode)) {
         terminateCurrentTranslation();

         if (isCapturedHoverLocationValid(editor, captured)) {
            // 内容不可翻译时仍回到捕获位置，便于用户看到原始 Hover。
            const targetPosition = editor.document.validatePosition(captured.position);

            editor.selection = new vscode.Selection(targetPosition, targetPosition);
            editor.revealRange(
               new vscode.Range(targetPosition, targetPosition),
               vscode.TextEditorRevealType.InCenterIfOutsideViewport,
            );
         }

         void vscode.window.showInformationMessage(vscode.l10n.t("No text requiring translation was detected"));

         try {
            await reopenHover();
         } catch (error) {
            output.appendLine(
               vscode.l10n.t("Failed to reopen Hover: {error}", {
                  error: formatError(error),
               }),
            );
         }

         return;
      }

      const targetPosition = editor.document.validatePosition(captured.position);

      const key = createHoverKey(editor.document, targetPosition);
      const cacheKey = createCurrentTranslationCacheKey(captured.contentKey, configTool, translationMode);
      const state = translationState;

      if (isSameTranslationRequest(state, captured) && state.kind === "loading") {
         // 同一请求仍在执行时复用当前任务，避免重复调用翻译服务。
         return;
      }

      if (state.kind === "loading") {
         state.terminate();
      }

      translationState = { kind: "idle" };

      // 主动触发表示强制刷新；同步清除内存条目，并按写入队列删除持久缓存。
      void translationCache.delete(cacheKey).catch((error) => {
         output.appendLine(
            vscode.l10n.t("Failed to delete translation cache entry: {error}", {
               error: formatError(error),
            }),
         );
      });

      const requestId = ++nextRequestId;
      const task = AggregationTranslation(captured.contents, configTool);

      // 把 rejection 转为结果值，使命令和 Hover Provider 能安全等待同一个 Promise。
      const translationPromise = task.promise.then<TranslationOutcome, TranslationOutcome>(
         (translatedText) =>
            translatedText === getOriginalSourceText(captured.contents)
               ? { kind: "unchanged" }
               : {
                    kind: "success",
                    translatedText,
                 },
         (error) => ({
            kind: "error",
            error,
         }),
      );

      const request: LoadingTranslationState = {
         kind: "loading",
         requestId,
         key,
         contentKey: captured.contentKey,
         configurationRevision: translationConfigurationRevision,
         promise: translationPromise,
         terminate: task.terminate,
      };

      translationState = request;

      // showHover 只能在当前光标位置打开，因此先同步选择和可见区域。
      editor.selection = new vscode.Selection(targetPosition, targetPosition);

      editor.revealRange(
         new vscode.Range(targetPosition, targetPosition),
         vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );

      try {
         const progressPromise = vscode.window.withProgress(
            {
               location: vscode.ProgressLocation.Notification,
               title: vscode.l10n.t("Translating..."),
               cancellable: false,
            },
            async () => {
               await translationPromise;
            },
         );

         // 只重开一次。语言服务立即恢复原内容，本 Provider 在同一轮
         // Hover 请求中等待共享任务，并在完成后直接追加结果。
         await reopenHover();

         const outcome = await translationPromise;
         await progressPromise;

         if (translationState !== request) {
            // 状态对象按引用比较，只有仍为本请求时才能提交结果。
            return;
         }

         if (outcome.kind === "error") {
            translationState = { kind: "idle" };

            output.appendLine(
               vscode.l10n.t("Translation failed: {error}", {
                  error: formatError(outcome.error),
               }),
            );

            void vscode.window.showErrorMessage(
               vscode.l10n.t("Translation failed. See the {outputChannel} output for details.", {
                  outputChannel: outputChannelName,
               }),
            );

            return;
         }

         if (
            vscode.window.activeTextEditor !== editor ||
            editor.document.uri.toString() !== captured.documentUri ||
            editor.document.version !== captured.documentVersion
         ) {
            // 翻译期间切换编辑器或修改文档时，丢弃无法可靠定位的结果。
            translationState = { kind: "idle" };

            return;
         }

         if (outcome.kind === "unchanged") {
            translationState = { kind: "idle" };

            void vscode.window.showInformationMessage(
               vscode.l10n.t("The translation is identical to the source text, so no translated result was shown."),
            );

            return;
         }

         translationState = {
            kind: "translated",
            requestId,
            key,
            contentKey: captured.contentKey,
            configurationRevision: request.configurationRevision,
            translatedText: outcome.translatedText,
         };

         void translationCache.set(cacheKey, outcome.translatedText).catch((error) => {
            output.appendLine(
               vscode.l10n.t("Failed to write translation cache: {error}", {
                  error: formatError(error),
               }),
            );
         });
      } catch (error) {
         const currentState = translationState;

         if (currentState.kind !== "idle" && currentState.requestId === requestId) {
            translationState = { kind: "idle" };
         }

         output.appendLine(
            vscode.l10n.t("Translation failed: {error}", {
               error: formatError(error),
            }),
         );

         void vscode.window.showErrorMessage(
            vscode.l10n.t("Translation failed. See the {outputChannel} output for details.", {
               outputChannel: outputChannelName,
            }),
         );
      }
   });

   // 输入框只负责收集凭据，实际存储位置由 ConfigTool 根据用户设置决定。
   const configureCredentialsCommand = vscode.commands.registerCommand("floatingTranslation.configureCredentials", async () => {
      const translationTool = configTool.getSelect("translationTool");

      if (translationTool === "openaiCompatible") {
         const apiKey = await vscode.window.showInputBox({
            title: vscode.l10n.t("Configure OpenAI-compatible service credentials"),
            prompt: vscode.l10n.t("Enter the API key"),
            password: true,
            ignoreFocusOut: true,
         });

         if (apiKey === undefined) {
            return;
         }

         await configTool.set("openAiCompatibleApiKey", apiKey);

         const storageLabel =
            configTool.getSelect("credentialStorage") === "secretStorage"
               ? vscode.l10n.t("encrypted storage")
               : vscode.l10n.t("plain-text settings");

         void vscode.window.showInformationMessage(
            vscode.l10n.t("OpenAI-compatible service credentials were saved to {storage}", {
               storage: storageLabel,
            }),
         );
         return;
      }

      const credentialConfigurations = {
         aliyun: {
            service: vscode.l10n.t("Alibaba Cloud Translation"),
            publicLabel: "AccessKey ID",
            secretLabel: "AccessKey Secret",
            publicName: "aliyunAccessKeyId",
            secretName: "aliyunAccessKeySecret",
         },
         baidu: {
            service: vscode.l10n.t("Baidu Translate"),
            publicLabel: "APPID",
            secretLabel: vscode.l10n.t("secret key"),
            publicName: "baiduAppId",
            secretName: "baiduAppKey",
         },
      } as const;

      if (translationTool !== "aliyun" && translationTool !== "baidu") {
         void vscode.window.showErrorMessage(
            vscode.l10n.t("Unsupported translation service: {service}", {
               service: translationTool,
            }),
         );
         return;
      }

      const credentialConfiguration = credentialConfigurations[translationTool];
      const publicCredential = await vscode.window.showInputBox({
         title: vscode.l10n.t("Configure {service} credentials", {
            service: credentialConfiguration.service,
         }),
         prompt: vscode.l10n.t("Enter {credential}", {
            credential: credentialConfiguration.publicLabel,
         }),
         password: true,
         ignoreFocusOut: true,
      });

      if (publicCredential === undefined) {
         return;
      }

      const secretCredential = await vscode.window.showInputBox({
         title: vscode.l10n.t("Configure {service} credentials", {
            service: credentialConfiguration.service,
         }),
         prompt: vscode.l10n.t("Enter {credential}", {
            credential: credentialConfiguration.secretLabel,
         }),
         password: true,
         ignoreFocusOut: true,
      });

      if (secretCredential === undefined) {
         return;
      }

      await configTool.set(credentialConfiguration.publicName, publicCredential);
      await configTool.set(credentialConfiguration.secretName, secretCredential);

      const storageLabel =
         configTool.getSelect("credentialStorage") === "secretStorage"
            ? vscode.l10n.t("encrypted storage")
            : vscode.l10n.t("plain-text settings");

      void vscode.window.showInformationMessage(
         vscode.l10n.t("{service} credentials were saved to {storage}", {
            service: credentialConfiguration.service,
            storage: storageLabel,
         }),
      );
   });

   // 清理命令仅操作扩展的加密存储，不修改用户维护的明文设置。
   const clearCredentialsCommand = vscode.commands.registerCommand("floatingTranslation.clearCredentials", async () => {
      const translationTool = configTool.getSelect("translationTool");

      if (translationTool !== "aliyun" && translationTool !== "baidu" && translationTool !== "openaiCompatible") {
         void vscode.window.showErrorMessage(
            vscode.l10n.t("Unsupported translation service: {service}", {
               service: translationTool,
            }),
         );
         return;
      }

      const service =
         translationTool === "aliyun"
            ? vscode.l10n.t("Alibaba Cloud Translation")
            : translationTool === "baidu"
              ? vscode.l10n.t("Baidu Translate")
              : vscode.l10n.t("OpenAI-compatible service");
      const clearCurrent = vscode.l10n.t("Clear only {service}", { service });
      const clearAll = vscode.l10n.t("Clear credentials for all services");
      const confirmation = await vscode.window.showWarningMessage(
         vscode.l10n.t(
            "Select the translation credentials to clear from encrypted storage. Plain-text settings will not be affected.",
         ),
         { modal: true },
         clearCurrent,
         clearAll,
      );

      if (confirmation === clearCurrent) {
         await configTool.clearCredentials(translationTool);
         void vscode.window.showInformationMessage(
            vscode.l10n.t("Encrypted credentials for {service} were cleared", { service }),
         );
      } else if (confirmation === clearAll) {
         await configTool.clearAllCredentials();
         void vscode.window.showInformationMessage(
            vscode.l10n.t("Encrypted credentials for all translation services were cleared"),
         );
      }
   });

   const clearWorkspaceCacheCommand = vscode.commands.registerCommand("floatingTranslation.clearWorkspaceCache", async () => {
      terminateCurrentTranslation();

      const persisted = await translationCache.clear();

      if (!persisted) {
         void vscode.window.showErrorMessage(
            vscode.l10n.t(
               "The workspace translation cache was cleared, but persistence failed. See the {outputChannel} output for details.",
               { outputChannel: outputChannelName },
            ),
         );
         return;
      }

      void vscode.window.showInformationMessage(vscode.l10n.t("The translation cache for the current workspace was cleared"));
   });

   const configurationChangeSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("floating-translation")) {
         invalidateTranslationConfiguration();
      }

      if (event.affectsConfiguration("floating-translation.maxCacheCount")) {
         void translationCache.trim().catch((error) => {
            output.appendLine(
               vscode.l10n.t("Failed to trim translation cache: {error}", {
                  error: formatError(error),
               }),
            );
         });
      }
   });
   const secretChangeSubscription = context.secrets.onDidChange(() => {
      invalidateTranslationConfiguration();
   });

   context.subscriptions.push(
      output,
      provider,
      triggerCommand,
      configureCredentialsCommand,
      clearCredentialsCommand,
      clearWorkspaceCacheCommand,
      configurationChangeSubscription,
      secretChangeSubscription,
   );
}

/** 清理仅存在于扩展宿主内的 Hover 和请求状态。 */
export function deactivate(): void {
   capturedHover = undefined;
   terminateCurrentTranslation();
   running.clear();
}

/** 等待当前翻译任务，并仅向仍然有效的同位置 Hover 返回结果。 */
async function providePendingTranslationHover(
   request: LoadingTranslationState,
   token: vscode.CancellationToken,
): Promise<vscode.Hover | undefined> {
   const outcome = await request.promise;

   if (token.isCancellationRequested || translationState !== request) {
      return undefined;
   }

   if (outcome.kind === "error") {
      return undefined;
   }

   if (outcome.kind === "unchanged") {
      return undefined;
   }

   return createTranslationHover(outcome.translatedText);
}

/** 将译文包装为可由 VS Code Hover 渲染的 Markdown 内容。 */
function createTranslationHover(translatedText: string): vscode.Hover {
   const content = new vscode.MarkdownString();

   content.appendMarkdown(translatedText);

   return new vscode.Hover(content);
}

/** 检查缓存是否包含可翻译片段且仍属于当前文档版本。 */
function isCapturedHoverValid(
   editor: vscode.TextEditor | undefined,
   captured: CapturedHover,
   translationMode: TranslationMode,
): boolean {
   return hasTranslatableContent(captured.contents, translationMode) && isCapturedHoverLocationValid(editor, captured);
}

/** 仅验证缓存的位置上下文，并通过类型谓词收窄 captured。 */
function isCapturedHoverLocationValid(
   editor: vscode.TextEditor | undefined,
   captured: CapturedHover | undefined,
): captured is CapturedHover {
   return Boolean(
      editor &&
      captured &&
      editor.document.uri.toString() === captured.documentUri &&
      editor.document.version === captured.documentVersion,
   );
}

/** 判断状态是否属于当前 Hover 内容和翻译配置。 */
function isSameTranslationRequest(state: TranslationState, captured: CapturedHover): boolean {
   return (
      state.kind !== "idle" &&
      state.key === captured.key &&
      state.contentKey === captured.contentKey &&
      state.configurationRevision === translationConfigurationRevision
   );
}

/** 终止当前任务并清除只在扩展宿主中保存的翻译状态。 */
function terminateCurrentTranslation(): void {
   const state = translationState;

   if (state.kind === "loading") {
      state.terminate();
   }

   translationState = { kind: "idle" };
}

/** 配置或凭据变化后终止旧任务，并使已完成译文失效。 */
function invalidateTranslationConfiguration(): void {
   translationConfigurationRevision += 1;
   terminateCurrentTranslation();
}

/** 生成能区分文档、版本和字符位置的 Hover 身份键。 */
function createHoverKey(document: vscode.TextDocument, position: vscode.Position): string {
   return [document.uri.toString(), document.version, position.line, position.character].join(":");
}

/** 按原始 Hover 展示顺序拼接完整 Markdown，用于判断翻译结果是否发生变化。 */
function getOriginalSourceText(contents: readonly TranslatableContent[]): string {
   return contents.map((content) => content.sourceText).join("\n\n");
}

/** 使用当前生效的翻译语义配置生成缓存键，排除凭据和请求调度参数。 */
function createCurrentTranslationCacheKey(
   contentKey: string,
   configTool: ConfigTool,
   translationMode: TranslationMode,
): string {
   return createTranslationCacheKey({
      contentKey,
      translationTool: configTool.getSelect("translationTool"),
      translationMode,
      sourceLanguage: configTool.getSelect("sourceLanguage") || "auto",
      targetLanguage: configTool.getSelect("targetLanguage") || vscode.env.language,
      openAiCompatibleEndpoint: configTool.getSelect("openAiCompatibleEndpoint"),
      openAiCompatibleModel: configTool.getSelect("openAiCompatibleModel"),
      customPrompt: configTool.getSelect("customPrompt"),
   });
}

/** 关闭旧 Hover，并在下一个事件循环重新打开当前光标位置的 Hover。 */
async function reopenHover(): Promise<void> {
   await vscode.commands.executeCommand("editor.action.hideHover");

   await waitForNextEventLoop();

   await vscode.commands.executeCommand("editor.action.showHover", {
      focus: "noAutoFocus",
   });
}

/** 让出当前事件循环，等待 hideHover 的界面状态完成更新。 */
async function waitForNextEventLoop(): Promise<void> {
   await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
   });
}

/** 将任意抛出值转换为适合输出通道展示的文本。 */
function formatError(error: unknown): string {
   return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
