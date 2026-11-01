<p align="center"><img src="src/assets/icon.png" width="120" alt="Stella icon"></p>

<h1 align="center">Stella</h1>

<p align="center">A futuristic desktop command center for <b>Claude</b>, <b>Codex</b> and <b>ChatGPT</b> on Windows.</p>

<p align="center">
  <a href="https://github.com/stelferovskiy/stella/releases/latest"><b>Download the installer</b></a> ·
  <a href="CODE_SIGNING_POLICY.md">Code signing policy</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="LICENSE">MIT license</a>
</p>

Stella wraps the AI coding agents you already use in a HUD-style interface with a living "star core" that reacts to what the agent is doing.

## Features

- **Three agents in one window** — Claude (via Claude Code), OpenAI Codex, and ChatGPT (through your ChatGPT account or an OpenAI API key).
- **Real chat UI** — Markdown, tables, code blocks with copy, and expandable steps for every command, file edit and search the agent performs.
- **Bridge** (`Ctrl+B`) — watch agents work live: code is typed character by character as Claude generates it, Codex edits are replayed, command output streams into a mini terminal, HTML pages rebuild in a live preview, and each step lights up as a star. Give one task to several agents at once.
- **Approvals** — allow / always allow / deny for Claude's commands and edits, with several permission modes.
- **History and projects** — every chat is saved locally, searchable and resumable; agents work in the project folder you choose.
- **Attachments** — attach files, drag and drop, paste screenshots.
- **Studio** — free image generation with FLUX through Cloudflare Workers AI (daily free quota), with a gallery.
- **Usage** — real Claude subscription limits (5-hour and weekly), token usage per agent.
- **Schedule** — tasks the agent runs on its own at set times.
- **Tray, global hotkey** (`Ctrl+Shift+Space`), notifications, optional start with Windows, built-in terminal.

## Install

1. Install [Node.js LTS](https://nodejs.org).
2. Download and run `Stella-Setup-x.y.z.exe` from [Releases](https://github.com/stelferovskiy/stella/releases/latest). The installer lets you choose the folder and whether to create desktop and Start menu shortcuts.
3. In Stella's **Systems** panel, install and sign in to the agents you want — each has a one-click button:
   - Claude: `npm install -g @anthropic-ai/claude-code` and `npm install -g @anthropic-ai/claude-agent-sdk --omit=optional`, then sign in.
   - Codex / ChatGPT: `npm install -g @openai/codex`, then `codex login`.
   - Studio: a free Cloudflare account, Account ID and a Workers AI API token.

Claude Code, the Claude Agent SDK and the Codex CLI are proprietary tools from Anthropic and OpenAI. Stella does not bundle or redistribute them; it talks to the copies you install.

**Uninstall:** Settings → Apps → Installed apps → Stella → Uninstall.

## Build from source

```bat
git clone https://github.com/stelferovskiy/stella
cd stella
npm install
npm start          :: run from source
npm run dist       :: build dist\Stella-Setup-x.y.z.exe
```

Official installers are built by the public [GitHub Actions workflow](.github/workflows/build.yml) on every version tag.

## Code signing

See [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md). Free code signing has been requested from SignPath.io with a certificate by SignPath Foundation; until it is approved, releases are unsigned.

---

## По-русски

Stella — настольный командный центр для Claude, Codex и ChatGPT с футуристическим интерфейсом и звёздным ядром, которое реагирует на работу агента. «Мостик» (Ctrl+B) показывает работу агентов вживую: код печатается по символам, команды выводят результат, сайт собирается в превью. Есть история чатов, проекты, подтверждения действий, вложения, расписание, генерация картинок (FLUX через Cloudflare, бесплатно с дневным лимитом), трей и горячая клавиша.

Установка: Node.js LTS → установщик из [Releases](https://github.com/stelferovskiy/stella/releases/latest) → в панели «Системы» установить и подключить нужных агентов. Данные чатов хранятся только на вашем компьютере ([приватность](PRIVACY.md)).
