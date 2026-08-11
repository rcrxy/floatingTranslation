import * as vscode from "vscode";
import {ConfigTool, normalizeTranslationMode, type TranslationMode} from "./Utils/ConfigTool";
import { output } from "./Utils/output";
import { TranslatableContentAnalyzer, type TranslatableContent } from "./Utils/TranslatableContentAnalyzer";
import {AggregationTranslation, hasTranslatableContent} from "./AggregationTranslation";

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
   /** Provider 和命令处理器共享的翻译任务。 */
   readonly promise: Promise<TranslationOutcome>;
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
        readonly translatedText: string;
     };

// 状态保存在扩展宿主进程内，仅覆盖当前 VS Code 窗口的最近一次 Hover。
let capturedHover: CapturedHover | undefined;
let translationState: TranslationState = { kind: "idle" };
let nextRequestId = 0;

/** 注册 Hover Provider、翻译命令和凭据管理命令。 */
export function activate(context: vscode.ExtensionContext): void {
   const configTool = new ConfigTool(context.secrets);
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

            const state = translationState;

            if (state.kind === "loading") {
               if (state.key === key) {
                  // 重开的同位置 Hover 等待已有任务，避免发起重复翻译。
                  return providePendingTranslationHover(state, token);
               }

               // 翻译期间不因其他位置触发 Hover 而废弃当前请求。
               return undefined;
            }

            if (state.kind === "translated" && state.key === key) {
               // 已完成结果只对最初的位置和文档版本有效。
               return createTranslationHover(state.translatedText);
            }

            if (state.kind !== "idle" && state.key !== key) {
               // 用户移动到其他位置后，不再向新 Hover 注入旧译文。
               translationState = { kind: "idle" };
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

               capturedHover = {
                  key,
                  contentKey: analysis.key,
                  documentUri: document.uri.toString(),
                  documentVersion: document.version,
                  position,
                  contents: analysis.contents,
               };

               if (hasTranslatableContent(analysis.contents, translationMode)) {
                  const valueCount = analysis.contents.reduce(
                     (count, content) => count + content.value.filter((value) => value.isTranslatable).length,
                     0,
                  );

                  output.appendLine(
                     `---------- 原文内容 ---------- \n${analysis.contents.map((content) => content.sourceText).join("\n\n")}`,
                  );
               }

               // 返回 undefined，让自然 Hover 仍由原始语言服务负责显示。
               return undefined;
            } catch (error) {
               capturedHover = undefined;

               output.appendLine(`读取 Hover 失败：${formatError(error)}`);

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
         translationState = {kind: "idle"};

         if (isCapturedHoverLocationValid(editor, captured)) {
            // 内容不可翻译时仍回到捕获位置，便于用户看到原始 Hover。
            const targetPosition = editor.document.validatePosition(captured.position);

            editor.selection = new vscode.Selection(targetPosition, targetPosition);
            editor.revealRange(
               new vscode.Range(targetPosition, targetPosition),
               vscode.TextEditorRevealType.InCenterIfOutsideViewport,
            );
         }

         void vscode.window.showInformationMessage("未检测到需要翻译的文本");

         try {
            await reopenHover();
         } catch (error) {
            output.appendLine(`重新打开 Hover 失败：${formatError(error)}`);
         }

         return;
      }

      const targetPosition = editor.document.validatePosition(captured.position);

      const key = createHoverKey(editor.document, targetPosition);

      const requestId = ++nextRequestId;

      output.appendLine(`开始异步翻译，原文长度：${getTranslatableSourceLength(captured.contents, translationMode)}`);
      output.appendLine(
         `---------- 转换后待翻译内容 ----------\n${getTranslatableSourceText(captured.contents, translationMode)}`,
      );

      // 把 rejection 转为结果值，使命令和 Hover Provider 能安全等待同一个 Promise。
      const translationPromise = AggregationTranslation(captured.contents, configTool).then<
         TranslationOutcome,
         TranslationOutcome
      >(
         (translatedText) => ({
            kind: "success",
            translatedText,
         }),
         (error) => ({
            kind: "error",
            error,
         }),
      );

      const request: LoadingTranslationState = {
         kind: "loading",
         requestId,
         key,
         promise: translationPromise,
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
               title: "正在翻译...",
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
            output.appendLine("异步翻译已完成，但当前请求已失效");

            return;
         }

         if (outcome.kind === "error") {
            translationState = { kind: "idle" };

            output.appendLine(`翻译失败：${formatError(outcome.error)}`);

            void vscode.window.showErrorMessage("翻译失败，详细信息请查看 FloatingTranslation 输出");

            return;
         }

         if (
            vscode.window.activeTextEditor !== editor ||
            editor.document.uri.toString() !== captured.documentUri ||
            editor.document.version !== captured.documentVersion
         ) {
            // 翻译期间切换编辑器或修改文档时，丢弃无法可靠定位的结果。
            translationState = { kind: "idle" };

            output.appendLine("异步翻译已完成，但目标文档已发生变化");

            return;
         }

         translationState = {
            kind: "translated",
            requestId,
            key,
            translatedText: outcome.translatedText,
         };

         output.appendLine("异步翻译完成并追加到当前 Hover");
      } catch (error) {
         const currentState = translationState;

         if (currentState.kind !== "idle" && currentState.requestId === requestId) {
            translationState = { kind: "idle" };
         }

         output.appendLine(`翻译失败：${formatError(error)}`);

         void vscode.window.showErrorMessage("翻译失败，详细信息请查看 FloatingTranslation 输出");
      }
   });

   // 输入框只负责收集凭据，实际存储位置由 ConfigTool 根据用户设置决定。
   const configureCredentialsCommand = vscode.commands.registerCommand("floatingTranslation.configureCredentials", async () => {
      const translationTool = configTool.getSelect("translationTool");
      const credentialLabels =
         translationTool === "baidu"
            ? {service: "百度翻译", apiKey: "APPID", secretKey: "密钥"}
            : {service: "阿里云翻译", apiKey: "AccessKey ID", secretKey: "AccessKey Secret"};
      const apiKey = await vscode.window.showInputBox({
         title: `配置${credentialLabels.service}凭据`,
         prompt: `请输入 ${credentialLabels.apiKey}`,
         password: true,
         ignoreFocusOut: true,
      });

      if (apiKey === undefined) {
         return;
      }

      const secretKey = await vscode.window.showInputBox({
         title: `配置${credentialLabels.service}凭据`,
         prompt: `请输入 ${credentialLabels.secretKey}`,
         password: true,
         ignoreFocusOut: true,
      });

      if (secretKey === undefined) {
         return;
      }

      await configTool.set("apiKey", apiKey);
      await configTool.set("secretKey", secretKey);

      const storageLabel = configTool.getSelect("credentialStorage") === "secretStorage" ? "加密存储" : "明文设置";

      void vscode.window.showInformationMessage(`${credentialLabels.service}凭据已写入${storageLabel}`);
   });
   // 清理命令同时覆盖两种存储，避免切换模式后旧凭据重新生效。
   const clearCredentialsCommand = vscode.commands.registerCommand("floatingTranslation.clearCredentials", async () => {
      const confirmation = await vscode.window.showWarningMessage(
         "确定要清除明文设置和加密存储中的全部翻译凭据吗？",
         { modal: true },
         "清除",
      );

      if (confirmation !== "清除") {
         return;
      }

      await configTool.clearCredentials();
      void vscode.window.showInformationMessage("翻译凭据已清除");
   });

   context.subscriptions.push(output, provider, triggerCommand, configureCredentialsCommand, clearCredentialsCommand);
}

/** 清理仅存在于扩展宿主内的 Hover 和请求状态。 */
export function deactivate(): void {
   capturedHover = undefined;
   translationState = { kind: "idle" };
   running.clear();
}

/** 等待当前翻译任务，并仅向仍然有效的同位置 Hover 返回结果。 */
async function providePendingTranslationHover(
   request: LoadingTranslationState,
   token: vscode.CancellationToken,
): Promise<vscode.Hover | undefined> {
   const outcome = await request.promise;

   if (token.isCancellationRequested || translationState !== request) {
      output.appendLine("异步翻译已完成，但当前 Hover 已取消");
      return undefined;
   }

   if (outcome.kind === "error") {
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

/** 生成能区分文档、版本和字符位置的 Hover 身份键。 */
function createHoverKey(document: vscode.TextDocument, position: vscode.Position): string {
   return [document.uri.toString(), document.version, position.line, position.character].join(":");
}

/** 统计实际会发送给翻译服务的字符数。 */
function getTranslatableSourceLength(contents: readonly TranslatableContent[], translationMode: TranslationMode): number {
   if (translationMode === "fullText" || translationMode === "codeBlocks") {
      return contents.reduce((length, content) => length + content.sourceText.length, 0);
   }

   return contents.reduce(
      (contentLength, content) =>
         contentLength +
         content.value.reduce((valueLength, value) => valueLength + (value.isTranslatable ? value.text.length : 0), 0),
      0,
   );
}

/** 拼接实际会发送给翻译服务的文本，仅用于诊断输出。 */
function getTranslatableSourceText(contents: readonly TranslatableContent[], translationMode: TranslationMode): string {
   if (translationMode === "fullText" || translationMode === "codeBlocks") {
      return contents.map((content) => content.sourceText).join("\n\n");
   }

   return contents
      .flatMap((content) => content.value)
      .filter((value) => value.isTranslatable)
      .map((value) => value.text)
      .join("\n\n");
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
