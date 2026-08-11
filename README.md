# FloatingTranslation

FloatingTranslation 是一个用于验证 VS Code Hover 内容翻译方案的扩展。它会读取鼠标悬浮窗口（Hover）中的内容，在用户主动触发命令后翻译其中的自然语言片段，再将译文追加到重新打开的悬浮窗口底部。

## 当前功能

- 通过快捷键主动开始翻译，不改变普通鼠标 Hover 的触发方式。
- 支持翻译服务：阿里云（`aliyun`）、百度翻译（`baidu`）。

## 使用方式

1. 将鼠标移动到能够显示 Hover 的代码位置，等待原始 Hover 出现。
2. 选择翻译服务，并配置对应凭据和语言代码。
3. 确认 Hover 内容满足下方的“内容识别规则”。
4. 按 `Ctrl+Alt+T`，或从命令面板执行 `Floating Translation: trigger`。
5. 扩展会回到最近捕获的 Hover 位置，重新打开 Hover，并在异步处理完成后追加翻译结果。

快捷键当前仅在 `package.json` 中声明了 `Ctrl+Alt+T`。如有冲突，可在 VS Code 的键
盘快捷方式设置中为命令 `floatingTranslation.trigger` 重新绑定快捷键。

可在 VS Code 设置中配置以下项目：

- `floating-translation.sourceLanguage`：源语言代码，默认为 `auto`。
- `floating-translation.targetLanguage`：目标语言代码；留空时使用 VS Code 当前显示语言。
- `floating-translation.credentialStorage`：凭据存储方式，可选普通用户设置或 VS Code `SecretStorage`。
- `floating-translation.apiKey`：阿里云使用 AccessKey ID，百度翻译使用 APPID。
- `floating-translation.secretKey`：阿里云使用 AccessKey Secret，百度翻译使用密钥。

如果选择 `SecretStorage`，请从命令面板执行 `Floating Translation: Configure Credentials` 输入凭据。执行 `Floating Translation: Clear Credentials` 会同时清除普通用户设置和 `SecretStorage` 中的凭据。

普通用户设置中的凭据以明文形式保存，不应提交到版本控制。待翻译文本会发送到当前选择的第三方翻译服务，并可能产生费用；请根据实际数据处理要求核对服务条款、日志留存和合规要求。

## 内容识别规则

当前版本会汇总最近一次 Hover 位置上各个 Hover Provider 返回的内容，并按以下规则处理：

- 不要求 Hover 以代码围栏开头；任意包含自然语言字母的 Markdown 段落都可能成为待翻译内容。
- 普通段落按空行和部分块级 Markdown 结构拆分，每个可翻译片段单独请求翻译服务；适配器批量发起请求并按原顺序返回结果。
- 带语言标记或不带语言标记的 Markdown 代码围栏均按原文保留，不发送到翻译服务。
- 链接定义、分隔线、缩进代码和未闭合的代码围栏按原文保留。
- 行内代码、图片、链接、删除线、粗体、斜体、转义字符、URL、文件路径、命令参数以及部分常见代码标识符会替换为占位符；译文返回后再恢复原内容。
- 如果译文包含未知或重复占位符，本次翻译会失败；如果占位符丢失，扩展会将未恢复内容作为诊断代码块附加到译文末尾。
- 完全由代码、数字、符号或受保护内容组成的 Hover 不会触发翻译，并提示“未检测到需要翻译的文本”。

## 警告与已知限制

> [!WARNING]
> **核心功能依赖兼容性不稳定的 `editor.action.showHover` 命令。**
>
> 当前实现必须调用 `editor.action.showHover` 才能在快捷键触发翻译后重新打开悬浮窗口。
> 该命令没有为本扩展所需的 Hover 位置、触发来源和生命周期提供稳定的公开契约，其行为可能随 VS Code 版本变化。
> 无法保证本插件在未来版本的 VS Code 中仍能正常重新打开 Hover 或追加翻译结果。

> [!WARNING]
> **重新打开的 Hover 无法同时满足“随鼠标移动关闭”和“移入后滚动长内容”。**
>
> 扩展通过命令重新打开的 Hover 会被 VS Code 视为键盘触发的 Hover。
> 当 `editor.hover.sticky` 为 `true` 时，可以将鼠标移入悬浮窗口并滚动查看较长内容，但移动鼠标不会关闭该窗口，需要按 `Esc` 或点击编辑区域关闭。
>
> 将 `editor.hover.sticky` 设置为 `false` 后，移动鼠标可以关闭 Hover，但鼠标也无法稳定移入悬浮窗口，因此较长内容可能无法滚动查看。
> VS Code 当前的稳定扩展 API 不允许本扩展为重新打开的 Hover 指定鼠标触发来源，也不提供可用于可靠模拟该生命周期的编辑器鼠标移动事件，所以目前无法在扩展内部修复这一冲突。
> 扩展不会自动修改用户的 `editor.hover.sticky` 设置。

> [!WARNING]
> **Markdown 块级结构不会全部保留。**
>
> 当前分析器会移除列表标记、标题标记和引用标记后翻译正文，因此译文中的列表、标题和引用样式可能丢失。粗体、斜体、删除线和完整 Markdown 链接目前作为整体受保护，其中的可见文字也不会翻译。代码标识符保护基于启发式规则，无法保证覆盖所有命名形式。

> [!WARNING]
> **项目输出可能包含待翻译文本。**
>
> 为便于诊断，当前实现会向 `FloatingTranslation` 输出通道记录捕获的 Hover 原文、占位符转换后的待翻译文本和占位符恢复前的译文。处理敏感内容时应注意 VS Code 输出日志的可见范围和留存方式。

## 开发

环境要求：

- Node.js 和 npm。
- VS Code `1.125.0` 或更高版本。

安装依赖：

```shell
npm install
```

常用命令：

```shell
npm run compile
npm run watch
npm run lint
npm test
```

其中 `npm run compile` 和 `npm test` 会生成构建或测试产物；执行前请确认工作区允许写入相应输出目录。

### 打包

生成生产模式的 Webpack 构建：

```shell
npm run package
```

构建结果位于 `dist/`。如需生成可安装和分发的 VSIX 文件，请先安装 VS Code 官方打包工具：

```shell
npm install -g @vscode/vsce
```

然后在项目根目录执行：

```shell
vsce package
```

`vsce package` 会自动执行 `vscode:prepublish`，由该脚本调用 `npm run package` 完成生产构建，并根据 `.vscodeignore` 排除不需要分发的文件。
打包完成后，项目根目录会生成 `floating-translation-<version>.vsix`。

可通过 VS Code 扩展视图右上角的“从 VSIX 安装...”安装该文件，也可以使用命令行：

```shell
code --install-extension floating-translation-<version>.vsix
```
