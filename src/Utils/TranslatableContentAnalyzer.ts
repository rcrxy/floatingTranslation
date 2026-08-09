import { createHash } from "node:crypto";

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
    public constructor(private readonly text: string) {}

    public invoke(): TranslatableContentResult {
        const fenceMatch = languageFenceAtStart.exec(this.text);

        if (!fenceMatch) {
            return this.createNotTranslatableResult();
        }

        const language = fenceMatch[1].toLowerCase();
        const contents = this.text
            .slice(fenceMatch[0].length)
            .split(/\r?\n[ \t]*\r?\n+/)
            .map(content => content.trim())
            .filter(content => content.length > 0);

        if (contents.length === 0) {
            return this.createNotTranslatableResult();
        }

        const keySource = JSON.stringify({ language, contents });
        const key = createHash("sha256").update(keySource, "utf8").digest("hex");

        return {
            isTranslatable: true,
            language,
            contents,
            key,
        };
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
