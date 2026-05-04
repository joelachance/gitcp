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

## Global shortcut

The app tries **⌘+P+R** (macOS) or **Ctrl+P+R** (Windows/Linux) first. If that cannot be registered, it falls back to **⌘+Shift+P** / **Ctrl+Shift+P**. The footer of the window shows the active shortcut.

## What v0.1 does not include

- Personal access tokens (OAuth only)
- GitHub Enterprise host switching
- Persistent search cache / SQLite
- Installers and code signing (use `bun run start` for local use)

## License

MIT (match your repo policy if different).
