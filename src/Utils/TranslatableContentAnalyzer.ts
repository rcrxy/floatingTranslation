import { createHash } from "node:crypto";
import * as vscode from "vscode";

export type TranslatableContentResult =
    | {
          readonly isTranslatable: false;
          readonly language: undefined;
          readonly contents: readonly [];
          readonly key: undefined;
      }
    | {
          readonly isTranslatable: true;
          readonly language: string;
          readonly contents: readonly string[];
          readonly key: string;
      };

const languageFenceAtStart = /^[ \t]*```([^\s`\r\n]+)[^\r\n]*\r?\n[\s\S]*?\r?\n[ \t]*```[ \t]*(?:\r?\n|$)/;

export class TranslatableContentAnalyzer {
    public constructor(private readonly hovers: readonly vscode.Hover[]) {}

    public invoke(): TranslatableContentResult {
        const result = this.findTranslatableContent();

        return result ?? this.createNotTranslatableResult();
    }

    private findTranslatableContent(): TranslatableContentResult | undefined {
        for (const hover of this.hovers) {
            const sourceText = this.extractSourceText(hover);
            const result = this.analyzeSourceText(sourceText);

            if (result) {
                return result;
            }
        }

        return undefined;
    }

    private extractSourceText(hover: vscode.Hover): string {
        return hover.contents
            .filter((content): content is vscode.MarkdownString => content instanceof vscode.MarkdownString)
            .map(content => content.value)
            .join("\n\n");
    }

    private analyzeSourceText(sourceText: string): TranslatableContentResult | undefined {
        const fenceMatch = languageFenceAtStart.exec(sourceText);

        if (!fenceMatch) {
            return undefined;
        }

        const language = fenceMatch[1].toLowerCase();
        const contents = this.extractContents(sourceText, fenceMatch[0].length);

        if (contents.length === 0) {
            return undefined;
        }

        return {
            isTranslatable: true,
            language,
            contents,
            key: this.createContentKey(language, contents),
        };
    }

    private extractContents(sourceText: string, fenceLength: number): string[] {
        return sourceText
            .slice(fenceLength)
            .split(/\r?\n[ \t]*\r?\n+/)
            .map(content => content.trim())
            .filter(content => content.length > 0);
    }

    private createContentKey(language: string, contents: readonly string[]): string {
        const keySource = JSON.stringify({ language, contents });

        return createHash("sha256").update(keySource, "utf8").digest("hex");
    }

    private createNotTranslatableResult(): TranslatableContentResult {
        return {
            isTranslatable: false,
            language: undefined,
            contents: [],
            key: undefined,
        };
    }
}
