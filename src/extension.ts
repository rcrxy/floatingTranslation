import * as vscode from "vscode";
import { output } from "./Utils/output";
import { TranslatableContentAnalyzer } from "./Utils/TranslatableContentAnalyzer";
import { AggregationTranslation } from "./AggregationTranslation";

const running = new Set<string>();

interface CapturedHover {
   readonly key: string;
   readonly contentKey?: string;
   readonly documentUri: string;
   readonly documentVersion: number;
   readonly position: vscode.Position;
   readonly language?: string;
   readonly sourceContents?: readonly string[];
   readonly sourceText?: string;
}

type TranslationOutcome =
   | {
        readonly kind: "success";
        readonly translatedText: string;
     }
   | {
        readonly kind: "error";
        readonly error: unknown;
     };

interface LoadingTranslationState {
   readonly kind: "loading";
   readonly requestId: number;
   readonly key: string;
   readonly promise: Promise<TranslationOutcome>;
}

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

let capturedHover: CapturedHover | undefined;
let translationState: TranslationState = { kind: "idle" };
let nextRequestId = 0;

export function activate(context: vscode.ExtensionContext): void {
   const provider = vscode.languages.registerHoverProvider(
      { scheme: "*" },
      {
         async provideHover(document, position, token): Promise<vscode.Hover | undefined> {
            const key = createHoverKey(document, position);

            // executeHoverProvider 会再次调用当前 Provider。
            if (running.has(key)) {
               return undefined;
            }

            const state = translationState;

            if (state.kind === "loading") {
               if (state.key === key) {
                  return providePendingTranslationHover(state, token);
               }

               // 翻译期间不因其他位置触发 Hover 而废弃当前请求。
               return undefined;
            }

            if (state.kind === "translated" && state.key === key) {
               return createTranslationHover(state.translatedText);
            }

            if (state.kind !== "idle" && state.key !== key) {
               translationState = { kind: "idle" };
            }

            running.add(key);

            try {
               const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                  "vscode.executeHoverProvider",
                  document.uri,
                  position,
               );

               if (token.isCancellationRequested) {
                  return undefined;
               }

               const analysis = new TranslatableContentAnalyzer(hovers).invoke();
               const sourceText = analysis?.contents.join("\n\n");

               capturedHover = {
                  key,
                  contentKey: analysis?.key,
                  documentUri: document.uri.toString(),
                  documentVersion: document.version,
                  position,
                  language: analysis?.language,
                  sourceContents: analysis?.contents,
                  sourceText,
               };

               if (analysis) {
                  output.appendLine(
                     `已缓存可翻译 Hover，语言：${analysis.language}，内容数：${analysis.contents.length}，Key：${analysis.key}`,
                  );
                  output.appendLine(`原文内容：\n${sourceText}`);
               } else {
                  // output.appendLine("当前 Hover 未包含带语言标记的 Markdown 代码围栏");
               }

               // 自然 Hover 由原始语言服务负责显示。
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

   const triggerCommand = vscode.commands.registerCommand("floatingTranslation.trigger", async () => {
      const editor = vscode.window.activeTextEditor;
      const captured = capturedHover;

      if (!editor) {
         return;
      }

      if (!isCapturedHoverValid(editor, captured)) {
         translationState = { kind: "idle" };

         if (isCapturedHoverLocationValid(editor, captured)) {
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

      const translationPromise = AggregationTranslation(captured.sourceText).then<TranslationOutcome, TranslationOutcome>(
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

      editor.selection = new vscode.Selection(targetPosition, targetPosition);

      editor.revealRange(
         new vscode.Range(targetPosition, targetPosition),
         vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );

      output.appendLine(`开始异步翻译，原文长度：${captured.sourceText.length}`);

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
         // Hover 请求中等待翻译，并在完成后直接追加结果。
         await reopenHover();

         const outcome = await translationPromise;
         await progressPromise;

         if (translationState !== request) {
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

   context.subscriptions.push(output, provider, triggerCommand);
}

export function deactivate(): void {
   capturedHover = undefined;
   translationState = { kind: "idle" };
   running.clear();
}

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

function createTranslationHover(translatedText: string): vscode.Hover {
   const content = new vscode.MarkdownString();

   content.appendMarkdown(translatedText);

   return new vscode.Hover(content);
}

function isCapturedHoverValid(
   editor: vscode.TextEditor | undefined,
   captured: CapturedHover | undefined,
): captured is CapturedHover & { readonly sourceText: string } {
   return Boolean(captured?.sourceText && isCapturedHoverLocationValid(editor, captured));
}

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

function createHoverKey(document: vscode.TextDocument, position: vscode.Position): string {
   return [document.uri.toString(), document.version, position.line, position.character].join(":");
}

async function reopenHover(): Promise<void> {
   await vscode.commands.executeCommand("editor.action.hideHover");

   await waitForNextEventLoop();

   await vscode.commands.executeCommand("editor.action.showHover", {
      focus: "noAutoFocus",
   });
}

async function waitForNextEventLoop(): Promise<void> {
   await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
   });
}

function formatError(error: unknown): string {
   return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
