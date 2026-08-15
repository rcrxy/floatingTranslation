# FloatingTranslation GitHub Issue / PR 流程配置计划

## 目标

为 `FloatingTranslation` 建立一套适合个人维护、后续公开开源的轻量 GitHub 协作流程。

整体流程：

```text
Issue
  ↓
triage
  ↓
accepted
  ↓
feature/* / fix/*
  ↓
Pull Request
  ↓
CI
  ↓
Squash Merge
  ↓
main
  ↓
tag / GitHub Release
  ↓
VS Code Marketplace
```

核心原则：

- `main` 始终保持可发布状态。
- 不直接向 `main` 提交日常功能修改。
- Issue 用于记录 Bug、功能需求和待处理事项。
- PR 用于代码审查、CI 验证和变更记录。
- 使用 Squash Merge 保持主分支提交历史整洁。
- 初期不要求额外 Reviewer Approval，避免个人维护时阻塞流程。
- 仓库公开后开启 main 分支保护和安全漏洞私密报告。

---

# 1. 建立 `.github` 配置目录

计划新增：

```text
.github/
├─ ISSUE_TEMPLATE/
│  ├─ bug_report.yml
│  ├─ feature_request.yml
│  └─ config.yml
├─ pull_request_template.md
└─ workflows/
   └─ ci.yml

CONTRIBUTING.md
SECURITY.md
```

实施顺序：

1. Issue 模板
2. PR 模板
3. SECURITY.md
4. CONTRIBUTING.md
5. CI
6. 仓库公开后启用 Ruleset / Branch Protection

---

# 2. Issue 流程

## 2.1 Bug Report

建立：

```text
.github/ISSUE_TEMPLATE/bug_report.yml
```

建议要求用户填写：

- 问题描述
- 复现步骤
- 预期行为
- 实际行为
- VS Code 版本
- Floating Translation 版本
- 操作系统
- 当前使用的翻译平台
- 当前 `translationMode`
- 相关日志
- 其他补充信息

必须明确提醒：

> 不要提交 API Key、AccessKey、Secret、Token 或其他敏感凭据。

## 2.2 Feature Request

建立：

```text
.github/ISSUE_TEMPLATE/feature_request.yml
```

建议字段：

- 要解决的问题
- 使用场景
- 期望行为
- 建议方案（可选）
- 其他说明

避免把实现方式设为必填，让用户优先描述需求本身。

## 2.3 禁止普通 Blank Issue

建立：

```text
.github/ISSUE_TEMPLATE/config.yml
```

设置：

```yaml
blank_issues_enabled: false
```

目的：

- 减少缺少上下文的问题报告
- 统一 Bug / Feature Request 信息格式
- 降低后续 triage 成本

---

# 3. Issue Label 规划

首发阶段不建立过多标签。

建议保留：

## 类型

```text
bug
enhancement
documentation
```

## 状态

```text
triage
needs-info
accepted
```

## 翻译平台

```text
provider: aliyun
provider: baidu
provider: openai-compatible
```

## 功能区域

```text
area: hover
area: cache
area: credentials
```

## 社区贡献

```text
good first issue
help wanted
```

建议控制在约 10～15 个 Label。

---

# 4. Issue 生命周期

建议流程：

```text
用户提交 Issue
        ↓
      triage
        ↓
确认问题 / 确认需求
        ↓
     accepted
        ↓
创建开发分支
        ↓
       PR
        ↓
       CI
        ↓
      Merge
        ↓
自动关闭 Issue
```

PR 中使用：

```text
Closes #123
```

合并后自动关闭对应 Issue。

---

# 5. 分支模型

不采用复杂 Git Flow。

保留：

```text
main
feature/*
fix/*
refactor/*
docs/*
chore/*
```

示例：

```text
feature/deepl-support
fix/hover-cache
fix/123-openai-timeout
refactor/translation-adapter
docs/update-readme
chore/update-dependencies
```

原则：

> `main` 应始终处于理论上可以直接发布的状态。

---

# 6. Pull Request 流程

推荐：

```text
创建分支
   ↓
开发
   ↓
提交 PR → main
   ↓
CI
   ↓
解决 Review / Conversation
   ↓
Squash Merge
```

正式公开后尽量避免：

```text
git push origin main
```

---

# 7. PR 模板

建立：

```text
.github/pull_request_template.md
```

推荐结构：

```md
## Changes

简要描述此次修改。

## Related Issue

Closes #

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor
- [ ] Documentation
- [ ] Maintenance

## Checklist

- [ ] `npm test` 通过
- [ ] `npm run lint` 通过
- [ ] `npm run format:check` 通过
- [ ] 没有提交 API Key / AccessKey / Secret
- [ ] README 已根据需要更新
- [ ] CHANGELOG 已根据需要更新
- [ ] 已手动测试 VS Code Hover 翻译
```

模板保持简洁，不增加无实际价值的字段。

---

# 8. main 分支保护

仓库公开后建立 Ruleset：

```text
Repository
→ Settings
→ Rules
→ Rulesets
→ New branch ruleset
```

名称：

```text
Protect main
```

Target：

```text
Default branch
```

建议开启：

```text
Require a pull request before merging
Require status checks to pass
Require conversation resolution
Block force pushes
Restrict deletions
```

---

# 9. Approval 策略

当前主要由单人维护，因此：

```text
Require pull request before merging: ON
Required approvals: 0
```

原因：

如果设置：

```text
Required approvals: 1
```

个人维护时会需要额外拥有 Write 权限的人批准自己的 PR，增加不必要阻塞。

未来增加核心维护者后再调整为：

```text
Required approvals: 1
Dismiss stale approvals: ON
```

---

# 10. CI

计划新增：

```text
.github/workflows/ci.yml
```

基础检查：

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run package
```

初期建议使用单个 CI Job：

```text
CI / test
```

不必过早拆分为多个复杂 Job。

CI 稳定后，把它加入 main Ruleset：

```text
Require status checks before merging
```

---

# 11. Merge 策略

建议仓库仅保留：

```text
Allow squash merging
```

关闭：

```text
Allow merge commits
Allow rebase merging
```

同时开启：

```text
Automatically delete head branches
```

效果：

开发分支：

```text
commit
commit
fix
fix typo
test
```

最终进入 main：

```text
feat: support xxx (#123)
```

保持主分支历史清晰。

---

# 12. Commit / PR 命名规范

采用简化版 Conventional Commits：

```text
feat:
fix:
refactor:
docs:
test:
chore:
```

示例：

```text
feat: add encrypted credential storage
fix: invalidate hover cache after configuration changes
refactor: simplify translation task lifecycle
docs: update OpenAI-compatible endpoint documentation
chore: update dependencies
```

由于使用 Squash Merge：

> PR Title 的规范优先级高于开发分支内部每一次 commit。

---

# 13. SECURITY.md

FloatingTranslation 会处理：

- Alibaba Cloud AccessKey
- Baidu APP ID / Secret
- OpenAI-compatible API Key

因此需要建立：

```text
SECURITY.md
```

至少包含：

- 哪些版本仍接受安全更新
- 哪些问题属于安全漏洞
- 不要在公开 Issue 中提交凭据
- 安全漏洞的私密联系方式或报告方式
- 报告时建议提供的环境和复现信息

仓库公开后开启：

```text
Settings
→ Security
→ Private vulnerability reporting
```

用于私密提交：

- 凭据泄露
- SecretStorage 问题
- 敏感数据泄漏
- 请求安全问题
- 其他安全漏洞

---

# 14. CONTRIBUTING.md

建立：

```text
CONTRIBUTING.md
```

建议包含：

## 开发环境

```bash
npm install
npm run compile
```

## 测试

```bash
npm run format:check
npm run lint
npm test
npm run package
```

## 开发流程

```text
Issue
→ branch
→ PR
→ CI
→ Squash Merge
```

## 分支命名

```text
feature/*
fix/*
refactor/*
docs/*
chore/*
```

## PR 要求

- 一个 PR 尽量只解决一个问题
- 必须说明变更原因
- 有关联 Issue 时使用 `Closes #xxx`
- 不提交凭据
- 功能变化应同步更新 README / CHANGELOG

---

# 15. 发布流程

目标发布流程：

```text
Issue
   ↓
feature/* / fix/*
   ↓
PR
   ↓
CI passed
   ↓
Squash Merge
   ↓
main
   ↓
更新版本
   ↓
tag vX.Y.Z
   ↓
GitHub Release
   ↓
VS Code Marketplace
```

后续可进一步自动化：

```text
tag vX.Y.Z
    ↓
GitHub Actions
    ↓
npm ci
npm test
vsce package
    ↓
vsce publish
```

---

# 16. 实施阶段

## 第一阶段：现在即可完成

- [ ] 创建 `bug_report.yml`
- [ ] 创建 `feature_request.yml`
- [ ] 创建 `config.yml`
- [ ] 创建 `pull_request_template.md`
- [ ] 创建 `SECURITY.md`
- [ ] 创建 `CONTRIBUTING.md`

## 第二阶段：发布前

- [ ] 建立 `ci.yml`
- [ ] CI 执行 `npm ci`
- [ ] CI 执行 `npm run format:check`
- [ ] CI 执行 `npm run lint`
- [ ] CI 执行 `npm test`
- [ ] CI 执行 `npm run package`

## 第三阶段：仓库公开后

- [ ] 开启 GitHub Issues
- [ ] 配置 Label
- [ ] 建立 `Protect main` Ruleset
- [ ] Require PR before merging
- [ ] Require CI status checks
- [ ] Require conversation resolution
- [ ] Block force pushes
- [ ] Restrict branch deletion
- [ ] Required approvals 保持 `0`
- [ ] 仅启用 Squash Merge
- [ ] 开启 Automatically delete head branches
- [ ] 开启 Private vulnerability reporting

## 第四阶段：稳定后

- [ ] GitHub Release 自动化
- [ ] Marketplace 自动发布
- [ ] 根据贡献者数量决定是否启用 Required approvals
- [ ] 根据实际 Issue 数量调整 Labels
- [ ] 评估 Dependabot / CodeQL 等自动安全检查

---

# 最终推荐流程

```text
                 ┌─ Bug Report
用户 ─→ Issue ───┤
                 └─ Feature Request
                       │
                       ▼
                    triage
                       │
                       ▼
                  accepted
                       │
                       ▼
               fix/* / feature/*
                       │
                       ▼
                      PR
                       │
            ┌──────────┴─────────┐
            │                    │
           CI               Review comments
            │                    │
            └──────────┬─────────┘
                       ▼
                 Squash Merge
                       │
                       ▼
                     main
                       │
                       ▼
                tag / Release
                       │
                       ▼
             VS Code Marketplace
```
