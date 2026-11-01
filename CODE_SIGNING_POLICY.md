# Code signing policy

Free code signing for Windows releases is requested from [SignPath.io](https://signpath.io), with a certificate by the [SignPath Foundation](https://signpath.org). **Status: application submitted, not yet approved.** Until approval, release binaries are unsigned.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [stelferovskiy](https://github.com/stelferovskiy) |
| Approvers | [stelferovskiy](https://github.com/stelferovskiy) |

- **Committers** may modify the source code without additional review.
- **Reviewers** review all contributions from non-committers before they are merged.
- **Approvers** manually approve every signing request.

## What gets signed

Only installers built from this repository by the public GitHub Actions workflow in [`.github/workflows/build.yml`](.github/workflows/build.yml) are submitted for signing. Locally built binaries are never signed. Every signing request is approved manually by an approver.

## Contents of the signed package

The installer contains Stella's own source code and open-source components: [Electron](https://www.electronjs.org) (MIT), [xterm.js](https://xtermjs.org) (MIT), [node-pty](https://github.com/microsoft/node-pty) (MIT). It does **not** contain proprietary software. Claude Code, the Claude Agent SDK and the Codex CLI are installed separately by the user from npm and are not redistributed.

## Privacy

See [PRIVACY.md](PRIVACY.md). Stella transmits data only to the AI service the user selects, only when the user asks for it.
