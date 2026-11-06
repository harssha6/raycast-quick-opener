import { execFile, spawn } from "child_process";
import { existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { open as raycastOpen } from "@raycast/api";
import type { EditorId, ParsedPath, Preferences } from "./types";
import { sshCommand, sshTarget } from "./ssh";

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (err) => (err ? reject(err) : resolve()));
  });
}

/** Detached spawn — for Quick Look, which blocks while the preview is open. */
function runDetached(file: string, args: string[]) {
  const child = spawn(file, args, { detached: true, stdio: "ignore" });
  child.unref();
}

const EDITOR_APP: Record<EditorId, string> = {
  zed: "Zed",
  vscode: "Visual Studio Code",
  cursor: "Cursor",
  textedit: "TextEdit",
};

const EDITOR_CLI: Partial<Record<EditorId, string[]>> = {
  zed: [
    "/opt/homebrew/bin/zed",
    "/usr/local/bin/zed",
    "/Applications/Zed.app/Contents/MacOS/cli",
  ],
  vscode: ["/opt/homebrew/bin/code", "/usr/local/bin/code"],
  cursor: ["/opt/homebrew/bin/cursor", "/usr/local/bin/cursor"],
};

export async function openInEditor(p: ParsedPath, editor: EditorId) {
  const target = p.line
    ? `${p.absolute}:${p.line}${p.column ? `:${p.column}` : ""}`
    : p.absolute;
  // Prefer the editor CLI: it understands path:line:col (Zed, Code, Cursor all do).
  const clis = EDITOR_CLI[editor] ?? [];
  for (const cli of clis) {
    if (existsSync(cli)) {
      await run(cli, [target]);
      return;
    }
  }
  // Fall back to `open -a` — line:col is dropped for TextEdit, kept via URL scheme for Zed.
  if (editor === "zed" && p.line) {
    await raycastOpen(
      `zed://file${p.absolute}:${p.line}${p.column ? `:${p.column}` : ""}`,
    );
    return;
  }
  await run("open", ["-a", EDITOR_APP[editor], p.absolute]);
}

function appleScriptQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Open a terminal SSH'd into a remote directory. Host/user were strictly validated at parse time. */
export async function openSshTerminal(p: ParsedPath, prefs: Preferences) {
  if (!p.remote) return;
  const dir = p.isDirectory ? p.remote.path : dirname(p.remote.path);
  const cmd = sshCommand(p.remote.target, dir, p.remote.port);
  if (prefs.sshTerminal === "iterm") {
    await run("osascript", [
      "-e",
      `tell application "iTerm" to create window with default profile command ${appleScriptQuote(cmd)}`,
      "-e",
      `tell application "iTerm" to activate`,
    ]);
  } else {
    await run("osascript", [
      "-e",
      `tell application "Terminal" to do script ${appleScriptQuote(cmd)}`,
      "-e",
      `tell application "Terminal" to activate`,
    ]);
  }
}

/** Download a remote file via scp to a temp dir, for Quick Look / Preview. */
export async function downloadRemote(p: ParsedPath): Promise<string> {
  if (!p.remote) throw new Error("Not a remote path");
  const dir = mkdtempSync(join(tmpdir(), "quick-opener-"));
  const local = join(dir, basename(p.remote.path) || "download");
  const args: string[] = [];
  if (p.remote.port) args.push("-P", String(p.remote.port));
  args.push("--", `${sshTarget(p.remote.target)}:${p.remote.path}`, local);
  await run("scp", args);
  return local;
}

export async function openRemoteInEditor(p: ParsedPath, prefs: Preferences) {
  if (!p.remote) return;
  const r = p.remote;
  sshTarget(r.target);
  if (prefs.editor === "textedit") {
    await openSshTerminal(p, prefs);
    return;
  }
  const clis = EDITOR_CLI[prefs.editor] ?? [];
  const cli = clis.find((c) => existsSync(c));
  if (prefs.editor === "zed") {
    const portPart = r.port ? `:${r.port}` : "";
    const url = `ssh://${r.target}${portPart}${r.path}`;
    if (cli) {
      await run(cli, [url]);
      return;
    }
    await run("open", ["-a", "Zed", url]);
    return;
  }
  // VS Code / Cursor Remote-SSH
  const remoteArg = `ssh-remote+${r.target}`;
  const fileArg =
    p.line && !p.isDirectory
      ? `${r.path}:${p.line}${p.column ? `:${p.column}` : ""}`
      : r.path;
  if (cli) {
    await run(
      cli,
      p.isDirectory
        ? ["--remote", remoteArg, fileArg]
        : ["--remote", remoteArg, "--goto", fileArg],
    );
    return;
  }
  await openSshTerminal(p, prefs);
}

export async function openRemote(
  p: ParsedPath,
  prefs: Preferences,
): Promise<string> {
  if (!p.remote) throw new Error("Not a remote path");
  switch (p.category) {
    case "code":
    case "directory":
      if (prefs.editor !== "textedit") {
        await openRemoteInEditor(p, prefs);
        return `${EDITOR_APP[prefs.editor]} (SSH)`;
      }
      await openSshTerminal(p, prefs);
      return "SSH terminal";
    case "image":
    case "video":
    case "audio":
    case "pdf": {
      const local = await downloadRemote(p);
      quickLook({ ...p, absolute: local });
      return "Quick Look (downloaded)";
    }
    default:
      await openSshTerminal(p, prefs);
      return "SSH terminal";
  }
}

export async function openPrimary(
  p: ParsedPath,
  prefs: Preferences,
): Promise<string> {
  if (p.remote) return openRemote(p, prefs);
  if (p.isUrl && p.url) {
    await raycastOpen(p.url);
    return "Browser";
  }
  switch (p.category) {
    case "directory":
      await run("open", [p.absolute]);
      return "Finder";
    case "code":
      await openInEditor(p, prefs.editor);
      return EDITOR_APP[prefs.editor];
    case "image":
    case "video":
    case "audio":
      if (prefs.mediaMode === "quicklook") {
        quickLook(p);
        return "Quick Look";
      }
      if (prefs.mediaMode === "preview" && p.category === "image") {
        await run("open", ["-a", "Preview", p.absolute]);
        return "Preview";
      }
      await run("open", [p.absolute]);
      return "default app";
    case "pdf":
      if (prefs.mediaMode === "quicklook") {
        quickLook(p);
        return "Quick Look";
      }
      await run("open", ["-a", "Preview", p.absolute]);
      return "Preview";
    case "app":
      await run("open", [p.absolute]);
      return "app";
    case "archive":
    case "unknown":
    default:
      await revealInFinder(p);
      return "Finder";
  }
}

export function quickLook(p: ParsedPath) {
  // qlmanage -p blocks until the preview closes, so detach it.
  runDetached("qlmanage", ["-p", p.absolute]);
}

export async function revealInFinder(p: ParsedPath) {
  await run("open", ["-R", p.absolute]);
}

export async function openWithDefault(p: ParsedPath) {
  if (p.isUrl && p.url) return raycastOpen(p.url);
  await run("open", [p.absolute]);
}

export async function openInPreview(p: ParsedPath) {
  await run("open", ["-a", "Preview", p.absolute]);
}
