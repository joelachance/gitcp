# GitCP (Git Command Palette)

Minimal v0.1: a global shortcut opens a small window. Sign in with **GitHub OAuth only**, search **issues and pull requests** with the GitHub Search API, and press **Enter** to open the **canonical** `html_url` for that item in your browser.

## Requirements

- [Bun](https://bun.sh) (used for install and `bun x electron`)
- A **GitHub OAuth App** (not a GitHub App installation)

## GitHub OAuth app setup

1. Create an OAuth app: GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. **Authorization callback URL** must be exactly:

   `http://127.0.0.1:53682/callback`

   (This matches the default loopback port. To use another port, set `GITCP_OAUTH_PORT` and use the same URL with that port in the GitHub app settings.)
3. Copy the **Client ID** and generate a **Client secret**.

## Environment

Set these when running GitCP (or put them in your shell profile):

```bash
export GITCP_GITHUB_CLIENT_ID="your_client_id"
export GITCP_GITHUB_CLIENT_SECRET="your_client_secret"
```

Optional:

- `GITCP_OAUTH_PORT` — loopback port (default `53682`). Must match the callback URL registered on GitHub.

## Run

```bash
bun install
bun run start
```

On Linux, if you see a sandbox error when running as root, you can start the binary with `--no-sandbox` (only when you understand the tradeoff), e.g. `bun x electron . --no-sandbox`.

## Global shortcut and window

- **Shortcut:** **⌘+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows/Linux). A three-key shortcut like `⌘+P+R` is not used: on macOS, Electron can treat it like **⌘+R** and conflict with **Refresh**, so only **⌘+Shift+P** is registered. If that slot is taken, the app falls back to **⌘+Option+P** / **Ctrl+Alt+P**. A one-line note in the window shows the active shortcut.
- **UI:** Frameless, wide “composer” bar (like a chat input) with one main text field; **Escape** hides the window. The app **keeps running** in the background and **keeps your search state**; use the global shortcut again to show the palette. **Drag** the top edge of the window to move it.
- **Quit:** Use the system **Quit** command (e.g. **⌘+Q** on Mac, or close from the taskbar on Windows).

## What v0.1 does not include

- Personal access tokens (OAuth only)
- GitHub Enterprise host switching
- Persistent search cache / SQLite
- Installers and code signing (use `bun run start` for local use)

## License

MIT (match your repo policy if different).
