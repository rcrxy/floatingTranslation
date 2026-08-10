import * as vscode from "vscode";

/** 扩展共享的诊断输出通道，由扩展生命周期统一释放。 */
export const output = vscode.window.createOutputChannel("FloatingTranslation");
