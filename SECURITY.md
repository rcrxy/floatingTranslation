# Security Policy

Floating Translation handles credentials and sends Hover text to configured translation services. Security reports are treated separately from ordinary bug reports.

## Supported Versions

Only the latest published version receives security updates. Please reproduce the issue with the latest version before reporting it when doing so does not increase exposure.

## Reporting a Vulnerability

Do not disclose security vulnerabilities or credentials in a public Issue, Discussion, Pull Request, log, screenshot, or code sample.

After private vulnerability reporting is enabled for the public repository, submit reports through [GitHub private vulnerability reporting](https://github.com/rcrxy/floatingTranslation/security/advisories/new). If that entry is unavailable, do not publish vulnerability details; contact the repository owner privately before sending sensitive information.

Include the following information where applicable:

- Floating Translation and VS Code versions.
- Operating system and translation provider.
- A clear impact assessment and minimal reproduction steps.
- Whether the issue affects VS Code `SecretStorage`, plain-text settings, cached translations, request transport, or logs.
- Sanitized diagnostics that contain no API Key, AccessKey, Secret, Token, signature, account identifier, or sensitive business text.
- Any known mitigations or evidence of exploitation.

Reports involving credential exposure, unsafe credential storage, sensitive text leakage, insecure requests, or authorization bypasses should be treated as security vulnerabilities.

Please allow time to reproduce and assess the report before public disclosure. Confirmed issues will be addressed in the latest supported version, and disclosure timing will be coordinated with the reporter when practical.
