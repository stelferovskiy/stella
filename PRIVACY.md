# Privacy

Stella is a local desktop application. It has **no telemetry, analytics or tracking** and does not send any data to its authors.

## What stays on your computer

Chats, settings, scheduled tasks, generated images and usage counters are stored only on your computer, in `%APPDATA%\Stella\data`. API keys and tokens you enter are encrypted with Windows' built-in data protection (Electron `safeStorage`).

## What is sent, and only when you ask for it

Stella is a front end for third-party AI services. When you send a message or start a task, the content you provide (your text, attached files, and — for coding agents — files the agent reads in the project folder you chose) is sent to the service you selected:

| Feature | Service | Their privacy policy |
|---|---|---|
| Claude | Anthropic, via Claude Code / Claude Agent SDK installed by you | https://www.anthropic.com/legal/privacy |
| Codex, ChatGPT (account mode) | OpenAI, via Codex CLI installed by you | https://openai.com/policies/privacy-policy |
| ChatGPT (API key mode) | OpenAI API | https://openai.com/policies/privacy-policy |
| Studio (images) | Cloudflare Workers AI | https://www.cloudflare.com/privacypolicy/ |

Nothing is sent to any of these services unless you use the corresponding feature. You can stop using a feature at any time; removing your API key or token in Settings stops all requests to that service.

## System changes

Stella does not change system settings. The optional "start with Windows" setting (off by default) adds a standard autostart entry, which is removed when you turn the setting off. The installer only creates the shortcuts you choose.

## Uninstalling

Use **Settings → Apps → Installed apps → Stella → Uninstall**, or run `Uninstall Stella.exe` from the installation folder. Your chat data in `%APPDATA%\Stella` is kept so a reinstall keeps your history; delete that folder to remove it.
