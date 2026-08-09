# FloatingTranslation

FloatingTranslation 是一个处于早期开发阶段的 VS Code 扩展。它会读取鼠标悬浮窗口（Hover）中的内容，并在用户主动触发命令后，将异步翻译结果追加到重新打开的悬浮窗口底部。

## 当前功能

- 保留语言服务原本提供的 Hover 内容。
- 缓存鼠标最近指向位置的可翻译内容。
- 通过快捷键主动开始翻译，不改变普通鼠标 Hover 的触发方式。
- 翻译期间显示 VS Code 进度通知。
- 翻译完成后将结果追加到 Hover 内容底部。
- 使用内容摘要区分不同的待翻译内容。

## 使用方式

1. 将鼠标移动到能够显示 Hover 的代码位置，等待原始 Hover 出现。
2. 确认 Hover 内容满足下方的“内容识别规则”。
3. 按 `Ctrl+Alt+T`，或从命令面板执行 `Floating Translation: trigger`。
4. 扩展会重新打开当前位置的 Hover，并在异步处理完成后追加模拟翻译结果。

快捷键当前仅在 `package.json` 中声明了 `Ctrl+Alt+T`。如有冲突，可在 VS Code 的键盘快捷方式设置中为命令 `floatingTranslation.trigger` 重新绑定快捷键。

## 内容识别规则

当前版本只会翻译符合以下结构的 Markdown Hover：

- Hover 内容必须以带语言标记的 Markdown 代码围栏开头，例如 ` ```typescript `。
- 代码围栏结束后必须存在至少一段非空文本。
- 代码围栏后的文本按空行拆分并作为待翻译内容。

示例：

````markdown
```typescript
function greet(name: string): string;
```

Returns a greeting for the supplied name.

The name must not be empty.
````

如果最近缓存的 Hover 不满足规则，扩展会提示“未检测到需要翻译的文本”。

## 警告与已知限制

> [!WARNING]
> **重新打开的 Hover 无法同时满足“随鼠标移动关闭”和“移入后滚动长内容”。**
>
> 扩展通过命令重新打开的 Hover 会被 VS Code 视为键盘触发的 Hover。当 `editor.hover.sticky` 为 `true` 时，可以将鼠标移入悬浮窗口并滚动查看较长内容，但移动鼠标不会关闭该窗口，需要按 `Esc` 或点击编辑区域关闭。
>
> 将 `editor.hover.sticky` 设置为 `false` 后，移动鼠标可以关闭 Hover，但鼠标也无法稳定移入悬浮窗口，因此较长内容可能无法滚动查看。VS Code 当前的稳定扩展 API 不允许本扩展为重新打开的 Hover 指定鼠标触发来源，也不提供可用于可靠模拟该生命周期的编辑器鼠标移动事件，所以目前无法在扩展内部修复这一冲突。扩展不会自动修改用户的 `editor.hover.sticky` 设置。

> [!WARNING]
> **核心功能依赖兼容性不稳定的 `editor.action.showHover` 命令。**
>
> 当前实现必须调用 `editor.action.showHover` 才能在快捷键触发翻译后重新打开悬浮窗口。该命令没有为本扩展所需的 Hover 位置、触发来源和生命周期提供稳定的公开契约，其行为可能随 VS Code 版本变化。无法保证本插件在未来版本的 VS Code 中仍能正常重新打开 Hover 或追加翻译结果。

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
