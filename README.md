# Quick Opener

Select a path in a terminal, browser, chat, or note, then run Quick Opener to open it in the right app.

- `~/Projects/demo/README.md` → **Zed** (or your chosen editor)
- a folder → **Finder**
- `.png` / `.mp4` / `.mp3` → **Quick Look** first
- `.pdf` → Quick Look (or Preview, your choice)
- `~/Projects/demo/src/app.ts:42:10` → editor at that exact line
- a URL → browser
- anything unknown → revealed in Finder

## Commands

| Command | What it does |
|---|---|
| **Open Selected Path** (no-view) | Instant open. Grabs selected text, falls back to clipboard. Shows a HUD with where it opened. If it finds multiple paths or a missing file, it tells you instead of guessing. |
| **Open Path...** (view) | List UI with file icon, size, and date. Actions: primary open, Quick Look (`⌘Y`), Open in Editor (`⌘E`), Reveal in Finder (`⌘F`), Copy Path (`⌘⇧C`), Trash, and : for missing paths : Create File & Open. Accepts an optional path argument. |

## Preferences

- **Editor for Code & Text** : Zed (default), VS Code, Cursor, or TextEdit
- **Images & Video** : Quick Look (default), Preview, or Default App
- **SSH Terminal** : Terminal (default) or iTerm2
- **Default VPS** : an optional SSH host alias or `user@host`; when empty, the first supported host in `~/.ssh/config` is used for the extra remote action on missing local paths
- **Fall back to clipboard** : on by default

## Setup

Requires Raycast on macOS. Choose an installed editor in the extension's preferences; TextEdit works without an additional editor installation. Install your editor's command-line tool to support line and column navigation where available.

Assign a hotkey to **Open Selected Path** in Raycast Settings → Extensions → Quick Opener. If Raycast asks for Accessibility access when reading selected text, grant it in macOS System Settings → Privacy & Security → Accessibility. You can also copy a path to the clipboard or pass it to **Open Path...** as an argument.

SSH actions use the macOS `ssh` and `scp` tools and your existing SSH configuration. Set up authentication and accept the server's host key in Terminal before using remote editor or preview actions. VS Code and Cursor need their Remote SSH support for remote editing. Terminal actions may prompt macOS to allow Raycast to control Terminal or iTerm2.

## How paths are cleaned

Quotes, backticks, markdown links `[x](/path)`, `file://` URLs, and trailing punctuation are stripped. `~`, `$HOME`, and `:line:col` suffixes are understood. Relative paths resolve against your home directory. Local paths open through argument arrays. SSH terminal actions use a quoted command after validating the destination; configured SSH destinations must be a host alias or `user@host`, without options.

## Install permanently (no dev server)

To build from source, use Node.js 22.22.2 or later and install dependencies first:

```bash
npm ci
npm run build   # outputs the importable bundle to ./dist-build
```

Then in Raycast: search **Import Extension**, select the `dist-build` folder in this project. Done : it persists across reboots with no terminal running. To update after code changes: `npm run build` again and re-import the same folder (overwrites in place; your hotkey and preferences survive).

Note: while `npm run dev` is running, Raycast uses the dev copy. Stop it (Ctrl+C) after importing so there's only one Quick Opener.

## Develop

```bash
npm ci
npm run dev   # ray develop : loads it into Raycast with hot reload
npm run build
npm run lint
```

Suggested hotkey: bind **Open Selected Path** to `⌥O` (or your pick) in Raycast Settings → Extensions → Quick Opener. That binding is what makes the whole thing feel instant : select, `⌥O`, done.

## VPS / SSH paths

Select any of these and it just works:

- `deploy@my-vps:/srv/demo/README.md` → opens in your editor via remote SSH (Zed Remote / VS Code Remote-SSH)
- `deploy@myvps:/etc/nginx/nginx.conf:12` → editor at line 12 on the server (aliases from `~/.ssh/config` work)
- `ssh://user@host:2222/home/user/project` → remote folder in your editor
- Remote image/video/PDF → downloaded via `scp` to a temp folder, then Quick Look
- Remote folder with TextEdit as editor, or any unknown remote file → SSH terminal opened in that directory (Terminal or iTerm2, set in preferences)

Actions in **Open Path...** for remote files: Open Remotely in Editor (`⌘E`), SSH Terminal Here (`⌘T`), Download & Quick Look (`⌘Y`), Copy SSH Command.

Set **Default VPS** in preferences (e.g. `root@myvps`) and missing local paths get an extra "Open on VPS" action : bare `/var/log/...` paths otherwise stay local, no guessing.

## Download and import

Unzip the release bundle, then select its `quick-opener` folder in Raycast's **Import Extension** command. You need Raycast on macOS; Node is needed only to build from source.

## Privacy and limits

The extension reads selected text and, when enabled, the clipboard. It does not send either to an analytics service. Local paths resolve from your home folder, rather than the terminal's current directory. SSH actions use your existing SSH configuration and can connect to the server you select. Remote previews download files into temporary folders; those files are not automatically removed by this extension.

Remote editor compatibility depends on the editor and its SSH support. Use **SSH Terminal Here** when an editor cannot handle a destination or a custom port. IPv6 destinations are not supported in this version.

## Raycast Store

The extension is prepared for submission under the Raycast profile `harssha_vardan`. The maintainer runs `npm run publish` locally and authenticates with their own GitHub account. Raycast's CLI opens a pull request on `raycast/extensions`; the extension becomes available in the Store after Raycast reviews and merges that pull request. See [Raycast's publishing guide](https://developers.raycast.com/basics/publish-an-extension).
