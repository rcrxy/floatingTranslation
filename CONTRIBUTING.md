# Contributing to Floating Translation

Thank you for contributing to Floating Translation. Keep each change focused, avoid unrelated refactoring, and never include credentials or sensitive translated content.

## Development Setup

Requirements:

- A Node.js version compatible with the repository lock file and development dependencies.
- A VS Code version compatible with the `engines.vscode` declaration in `package.json`.

Install dependencies and compile the extension:

```bash
npm install
npm run compile
```

Use the VS Code extension development host for manual Hover translation testing.

## Development Workflow

1. Search existing Issues before creating a new one.
2. Create or confirm an accepted Issue for the change when applicable.
3. Create a branch from `main`.
4. Implement and test one focused change.
5. Open a Pull Request targeting `main` and resolve CI or review feedback.
6. Use Squash Merge after required checks pass.

Do not push routine feature or bug-fix work directly to `main`.

## Branch Names

Use one of these prefixes:

```text
feature/*
fix/*
refactor/*
docs/*
chore/*
```

Examples include `feature/deepl-support`, `fix/hover-cache`, and `docs/update-readme`.

## Commit and Pull Request Titles

Use the simplified Conventional Commits prefixes:

```text
feat:
fix:
refactor:
docs:
test:
chore:
```

Because Pull Requests are squash merged, the Pull Request title should accurately describe the final change.

## Validation

Run the checks relevant to your change before opening a Pull Request:

```bash
npm run format:check
npm run lint
npm test
npm run package
```

`npm test` launches VS Code integration tests. On a headless Linux environment, run it through `xvfb-run -a npm test`.

## Pull Request Requirements

- Keep one Pull Request focused on one problem.
- Explain what changed and why.
- Use `Closes #123` when the Pull Request should close a related Issue.
- Add or update tests for behavioral changes when practical.
- Update README and CHANGELOG when user-facing behavior changes.
- Do not commit generated secrets, API Key, AccessKey, Secret, Token, signatures, private endpoints, or sensitive Hover text.
- Sanitize logs, screenshots, fixtures, and sample requests before submitting them.

Translation providers and remote AI services can receive source text. Changes involving outbound requests must consider timeout, cancellation, retries, concurrency, rate limits, proxies, certificates, privacy, data retention, and cost.

## Security Reports

Do not open a public Issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md) instead.
