<h1 align="center">Floating Translation</h1>

<p align="center">
    <a href="README.md">简体中文</a> |
    <a href="README.en.md">English</a>
</p>

FloatingTranslation is an extension for translating content in VS Code hover windows. It captures the most recent Hover, translates its natural-language content after the user explicitly runs a command, and appends the translation to the bottom of the reopened Hover.

## Features

- Start translation explicitly with a keyboard shortcut without changing how ordinary mouse Hovers are triggered.
- Support Alibaba Cloud Machine Translation, Baidu Translate, and OpenAI-compatible services.
- Provide four translation scopes: full Hover, code block protection, service round-trip placeholders, and locally isolated placeholders.
- Connect OpenAI-compatible services to remote endpoints or local model services, with a configurable full Chat Completions URL, model identifier, and additional translation preferences.
- Reuse an in-progress task for the same Hover. When a translation already exists, pressing the shortcut again discards the matching cache entry and calls the translation service again.
- Cache completed translations for the current workspace. When the same Hover appears naturally again, a cache hit displays the translation without requiring another command.
- Support configurable QPS and concurrency limits for Alibaba Cloud and Baidu Translate. After a batched request fails or is superseded, remaining segments are no longer scheduled.
- Store credentials either in ordinary VS Code user settings or in `SecretStorage`.

## Usage

![FloatingTranslation usage demonstration](resources/演示.gif)

1. Move the pointer to a code location that can display a Hover and wait for the original Hover to appear.
2. Select a translation service in VS Code settings and configure its service parameters, credentials, and language codes.
3. Press `Ctrl+Alt+T`, or run `Floating Translation: Translate Hover` from the Command Palette.
4. The extension returns to the most recently captured Hover location, reopens the Hover, and appends the translation when it is ready.
5. When the same Hover appears again, the extension immediately appends a matching translation cached in the current workspace.

The default keyboard shortcut is `Ctrl+Alt+T`. If it conflicts with another shortcut, rebind the `floatingTranslation.trigger` command in VS Code Keyboard Shortcuts.

The following settings are available in VS Code:

| Setting                                              | Description                                                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `floating-translation.sourceLanguage`                | The source language code of the text to translate.                                                                                             |
| `floating-translation.targetLanguage`                | The target language code for translations. When empty, the current VS Code display language is used.                                           |
| `floating-translation.translationTool`               | The translation service currently in use: `aliyun`, `baidu`, or `openaiCompatible`.                                                            |
| `floating-translation.translationMode`               | Controls which content is sent to the translation service and how protected content is handled. See [Translation scopes](#translation-scopes). |
| `floating-translation.credentialStorage`             | The credential storage method: plain-text settings (`settings`) or encrypted storage (`secretStorage`).                                        |
| `floating-translation.maxCacheCount`                 | The maximum number of translation cache entries stored for the current workspace. Must be at least `1`.                                        |
| `floating-translation.generalPlatformCredentials`    | General translation platform request limits and credential settings.                                                                           |
| `floating-translation.openAiCompatibleConfiguration` | Endpoint, API key, model, and additional translation preferences for an OpenAI-compatible service.                                             |

### `floating-translation.generalPlatformCredentials`

| Field                   | Description                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `QPS`                   | The maximum number of requests started per second and in progress at the same time. Must be at least `1`. |
| `aliyunAccessKeyId`     | The Alibaba Cloud AccessKey ID. Read when credential storage is `settings`.                               |
| `aliyunAccessKeySecret` | The Alibaba Cloud AccessKey Secret. Read when credential storage is `settings`.                           |
| `baiduAppId`            | The Baidu Translate App ID. Read when credential storage is `settings`.                                   |
| `baiduAppKey`           | The Baidu Translate secret key. Read when credential storage is `settings`.                               |

### `floating-translation.openAiCompatibleConfiguration`

| Field                      | Description                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `openAiCompatibleEndpoint` | The complete HTTP or HTTPS Chat Completions URL. The extension does not append a request path automatically.                         |
| `openAiCompatibleApiKey`   | The API key for the OpenAI-compatible service. Read when credential storage is `settings`.                                           |
| `openAiCompatibleModel`    | The model identifier used by the target service. It must match the service's model list.                                             |
| `customPrompt`             | Additional translation preferences. These cannot override the extension's built-in output format and content-protection constraints. |

When `credentialStorage` is `settings`, the extension reads credentials from the two combined configuration objects. When `credentialStorage` is `secretStorage`, first select a translation service and then run `Floating Translation: Configure Credentials` from the Command Palette to write credentials for that service to `SecretStorage`. `QPS` is always read from `generalPlatformCredentials`. The OpenAI-compatible endpoint, model identifier, and additional translation preferences are always read from `openAiCompatibleConfiguration`.

Changing the credential storage method only changes where credentials are read from; it does not migrate or delete existing values. Run `Floating Translation: Clear Credentials` to clear encrypted credentials for the current service or all services. This command does not modify any values in ordinary user settings.

The translation cache is stored in VS Code `workspaceState`. It follows the current workspace, is not written to the project directory, and is not shared across workspaces. The extension does not additionally encrypt cached content. The cache stores only the final assembled translations and never stores credentials. Run `Floating Translation: Clear Workspace Cache` to clear all translation cache entries for the current workspace.

Credentials in ordinary user settings are stored as plain text and must not be committed to version control. When a remote translation service is used, the text to translate is sent to the selected service and may incur charges. Review the service terms, log retention policy, and compliance requirements for your data.

### Request scheduling and result reuse

The extension identifies the current task using the document version, Hover location, Hover content digest, and translation configuration revision. Pressing the shortcut repeatedly while the same request is in progress does not call the translation service again. Pressing it again after the same request has completed, or after a natural Hover has used the cache, deletes the matching cache entry and calls the translation service again.

When the user moves to another Hover and triggers translation again, the extension terminates the old task and translates the most recently captured content. If the translation service, languages, translation scope, service configuration, or encrypted credentials change, an in-progress task is terminated and the most recent completed translation is invalidated.

Successfully translated and assembled text is written to the persistent cache for the current workspace, so natural Hovers can still use it after the extension restarts. After a forced refresh succeeds, the new translation is written back to the cache. If the refresh fails, the discarded old translation is not used as a fallback. Cache keys include the original Hover content digest, translation service, translation mode, source language, target language, and the OpenAI-compatible endpoint, model, and custom prompt. Old translations are therefore not reused after these semantic conditions change. Credentials, credential storage method, QPS, and document version are not included in cache keys.

The cache uses a least recently used policy and retains at most `floating-translation.maxCacheCount` entries. Reducing the capacity immediately removes older entries. Running `Floating Translation: Clear Workspace Cache` clears both the persistent cache and the current process's most recent translation state.

For content split into multiple segments, the extension stops scheduling segments that have not started after any segment fails or the task is terminated. The Baidu and OpenAI-compatible adapters use an abort signal to cancel in-flight HTTP requests. The Alibaba Cloud adapter stops subsequent scheduling and immediately ends the extension-side wait, but the current Alibaba Cloud SDK does not expose a public API for forcibly aborting requests that have already been sent. A small number of in-flight requests may therefore continue on the service side.

### OpenAI-compatible services

`openAiCompatibleEndpoint` must be a complete HTTP or HTTPS Chat Completions URL. The extension does not append a request path automatically. Both `openAiCompatibleApiKey` and `openAiCompatibleModel` must be non-empty. `customPrompt` provides additional translation preferences but cannot override the extension's built-in output format and content-protection constraints.

OpenAI-compatible requests use non-streaming responses. Each request has a 30-second timeout, and split text segments are processed with at most three concurrent requests. OpenAI-compatible services do not use `generalPlatformCredentials.QPS`. When a task is superseded or any segment fails, the extension stops scheduling later segments and attempts to abort requests in progress.

> [!IMPORTANT]
> **The extension supplies several compatibility parameters intended to disable thinking or reasoning modes in OpenAI-compatible requests.**
>
> Parameter names, structures, and support vary between models, inference frameworks, and API providers. A provider may ignore, override, or reject unsupported parameters, so these settings cannot be guaranteed to reach every model or provider. Refer to the target service's API documentation and actual responses for authoritative behavior.

> [!IMPORTANT]
> **When using a local model, the first translation may need to wait for the model to start.**
>
> The first request may start the local service or load the model. The delay depends on model size, hardware performance, and local service state. Subsequent requests can usually enter inference directly while the model remains running.

### Translation scopes

| Setting value        | Settings UI label                         | Content sent to the translation service                  | Use cases and risks                                                                                                   | Recommended service |
| -------------------- | ----------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `fullText`           | Translate full text                       | Complete Hover Markdown, including code                  | Provides the most context, but code and Markdown formatting may be translated or rewritten.                           |                     |
| `codeBlocks`         | Protect code blocks                       | Original Markdown except fenced and indented code blocks | Preserves block-level code. Inline code, links, and Markdown syntax may still be rewritten.                           |                     |
| `remotePlaceholders` | Protect placeholders (service round-trip) | Segmented text containing placeholder tokens             | Preserves more sentence context, but the service may modify tokens and prevent successful restoration.                |                     |
| `localPlaceholders`  | Protect placeholders (local isolation)    | Natural language between placeholders                    | Tokens never leave the local machine, providing the strongest protection, but splitting sentences may reduce context. | Baidu Translate     |

"Protect code blocks" recognizes fenced Markdown code blocks, unclosed fences, and code indented by four spaces or a Tab. "Protect placeholders (local isolation)" also preserves code blocks and locally protects inline code, links, paths, command arguments, and some code identifiers.

## Content recognition rules

The extension combines content returned by all Hover Providers at the most recently captured Hover location and processes it according to the selected translation scope:

- A Hover does not need to begin with a code fence. Any Markdown paragraph containing natural-language letters may be considered translatable.
- Placeholder modes split ordinary paragraphs at blank lines and some block-level Markdown structures. Adapters send batched requests and return results in the original order.
- Both placeholder modes preserve code fences, link definitions, horizontal rules, indented code, and unclosed fences.
- Placeholder modes protect inline code, images, links, strikethrough, bold, italics, escape sequences, URLs, file paths, command arguments, and some common code identifiers.
- Service round-trip mode detects unknown, duplicated, and missing tokens. Local isolation mode first reconstructs tokens exactly on the local machine and then performs the same validation and restoration.
- Full-text mode processes any non-empty Hover. Other modes do not trigger translation when no natural language remains after excluding code blocks or protected content, and show "No text requiring translation was detected."

## Warnings and known limitations

> [!WARNING]
> **The core feature depends on the `editor.action.showHover` command, whose compatibility is not stable.**
>
> The current implementation must call `editor.action.showHover` to reopen the hover window after translation is triggered with the keyboard shortcut.
> This command does not provide a stable public contract for the Hover location, trigger source, and lifecycle required by this extension, and its behavior may change between VS Code versions.
> The extension cannot guarantee that future VS Code versions will continue to reopen the Hover or append translated content correctly.

> [!WARNING]
> **A reopened Hover cannot simultaneously support both "close when the pointer moves" and "move the pointer into the Hover to scroll long content."**
>
> VS Code treats a Hover reopened by a command as keyboard-triggered.
> When `editor.hover.sticky` is `true`, the pointer can enter the Hover and scroll longer content, but moving the pointer does not close the Hover. Press `Esc` or click the editor area to close it.
>
> When `editor.hover.sticky` is `false`, moving the pointer can close the Hover, but the pointer cannot reliably enter the Hover, so longer content may not be scrollable.
> The stable VS Code extension API does not let this extension specify a pointer trigger source for a reopened Hover or expose editor pointer-movement events that could reliably emulate that lifecycle. The extension therefore cannot resolve this conflict internally.
> The extension never changes the user's `editor.hover.sticky` setting automatically.

> [!WARNING]
> **Not all block-level Markdown structures are preserved.**
>
> Both placeholder modes remove list, heading, and blockquote markers before translating the text, so list, heading, and blockquote styling may be lost in translations. Bold, italics, strikethrough, and complete Markdown links are currently protected as a whole, so their visible text is not translated either. Code identifier protection is heuristic and cannot cover every naming pattern. Full-text and code block protection modes use the original Markdown, but the translation service may rewrite its formatting.

> [!WARNING]
> **Extension output may contain text submitted for translation.**
>
> The `Floating Translation` output channel records the translation service, character count, and concurrency. When an OpenAI-compatible service is used, it also records the endpoint and model identifier. If a translation service loses a placeholder, diagnostic output includes the related source text and translation. Be mindful of the visibility and retention of VS Code output logs when processing sensitive content.

## Development

Requirements:

- Node.js and npm.
- VS Code `1.125.0` or later.

Install dependencies:

```shell
npm install
```

Common commands:

```shell
npm run compile
npm run watch
npm run lint
npm test
```

`npm run compile` and `npm test` generate build or test artifacts. Before running them, confirm that the workspace permits writing to the relevant output directories.

### Packaging

Create a production Webpack build:

```shell
npm run package
```

The build output is written to `dist/`. To create an installable and distributable VSIX file, first install the official VS Code packaging tool:

```shell
npm install -g @vscode/vsce
```

Then run the following command from the project root:

```shell
vsce package
```

`vsce package` automatically runs `vscode:prepublish`, which invokes `npm run package` to produce a production build and uses `.vscodeignore` to exclude files that should not be distributed.
After packaging completes, the project root contains `floating-translation-<version>.vsix`.

Install the file from the menu in the upper-right corner of the VS Code Extensions view by selecting "Install from VSIX...", or run:

```shell
code --install-extension floating-translation-<version>.vsix
```
