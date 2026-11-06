import { existsSync, readFileSync, statSync } from "fs";
import { extname, isAbsolute, join, resolve } from "path";
import { homedir } from "os";
import type { Category, ParsedPath } from "./types";

const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".md",
  ".markdown",
  ".txt",
  ".log",
  ".env",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".sh",
  ".zsh",
  ".bash",
  ".fish",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".vue",
  ".svelte",
  ".sql",
  ".xml",
  ".plist",
  ".lock",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
]);

const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".heic",
  ".heif",
  ".tiff",
  ".bmp",
  ".ico",
  ".avif",
]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const AUDIO_EXTS = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".ogg",
  ".m4a",
  ".aiff",
]);
const ARCHIVE_EXTS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".xz",
  ".bz2",
  ".7z",
  ".rar",
  ".dmg",
  ".pkg",
]);

function classify(ext: string, isDir: boolean, abs: string): Category {
  if (isDir) return "directory";
  if (abs.endsWith(".app")) return "app";
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  if (e === ".pdf") return "pdf";
  if (ARCHIVE_EXTS.has(e) || abs.toLowerCase().endsWith(".tar.gz"))
    return "archive";
  if (CODE_EXTS.has(e) || e === "") {
    // Extensionless files (Makefile, LICENSE, dotfiles) are usually text.
    // Dotfiles like .env, .zshrc also land here.
    const base = abs.split("/").pop() ?? "";
    if (
      !e &&
      (base.startsWith(".") ||
        /^[A-Z_]+$/.test(base) ||
        base === "Makefile" ||
        base === "Dockerfile")
    ) {
      return "code";
    }
    if (e) return "code";
    return "unknown";
  }
  return "unknown";
}

/** Strip wrappers people copy along with a path: quotes, markdown, prose punctuation. */
export function cleanCandidate(input: string): string {
  let s = input.trim();
  // Markdown link: [label](/path) or [label](file:///path)
  const md = s.match(/\[[^\]]*\]\(([^)]+)\)/);
  if (md) s = md[1].trim();
  // Bare markdown / angle-bracket wrap
  s = s.replace(/^<(.+)>$/, "$1");
  // Surrounding quotes
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^`+|`+$/g, "");
  // Trailing sentence punctuation that is never part of a copied path
  s = s.replace(/[,;]+$/, "");
  if (s.endsWith(".") && !s.endsWith("..")) s = s.slice(0, -1);
  s = s.replace(/[)\]]+$/, (m) => (s.includes("(") ? m : ""));
  return s.trim();
}

function expandHome(s: string): string {
  const home = homedir();
  if (s === "~") return home;
  if (s.startsWith("~/")) return join(home, s.slice(2));
  if (s.startsWith("$HOME/")) return join(home, s.slice(6));
  if (s === "$HOME") return home;
  return s.replace(/\$\{HOME\}/g, home).replace(/\$HOME/g, home);
}

const HOST_RE = /^[A-Za-z0-9._-]+$/;
const USER_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Parse ssh:// and scp-style remote paths. Host/user are strictly validated
 * (letters, digits, dot, dash, underscore) so the result is always safe to
 * pass as an argument to ssh/scp/editor CLIs.
 */
function parseRemote(s: string): {
  info: {
    target: string;
    host: string;
    user?: string;
    port?: number;
    path: string;
  };
  path: string;
  line?: number;
  column?: number;
} | null {
  // ssh://[user@]host[:port]/path
  const sshUrl = s.match(/^ssh:\/\/(?:([^@/]+)@)?([^/:]+)(?::(\d+))?(\/.*)$/);
  if (sshUrl) {
    const [, user, host, port, rawPath] = sshUrl;
    if (!HOST_RE.test(host) || (user && !USER_RE.test(user))) return null;
    const { path, line, column } = splitLineCol(rawPath);
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    return {
      info: {
        target: user ? `${user}@${host}` : host,
        host,
        user,
        port: port ? parseInt(port, 10) : undefined,
        path: decoded,
      },
      path: decoded,
      line,
      column,
    };
  }
  // [user@]host:/path — path must start with / so file.ts:42 never matches
  const scp = s.match(/^(?:([^@/\s]+)@)?([A-Za-z0-9._-]+):(\/.*)$/);
  if (scp) {
    const [, user, host, rawPath] = scp;
    if (!HOST_RE.test(host) || (user && !USER_RE.test(user))) return null;
    // A bare "localhost:" etc. is fine, but a single word followed by :/ in
    // prose is still a deliberate scp-style reference — accept it.
    const { path, line, column } = splitLineCol(rawPath);
    return {
      info: { target: user ? `${user}@${host}` : host, host, user, path },
      path,
      line,
      column,
    };
  }
  return null;
}

/** Split off a trailing :line or :line:col (stack traces, grep output). */
function splitLineCol(s: string): {
  path: string;
  line?: number;
  column?: number;
} {
  // Only treat suffix as line:col if the part before it looks path-like and suffix is numeric.
  const m = s.match(/^(.+?):(\d+)(?::(\d+))?$/);
  if (!m) return { path: s };
  const candidate = m[1];
  // Avoid mangling URLs (https://) — those are handled before this.
  if (candidate.includes("://")) return { path: s };
  // Avoid Windows-ish / scheme colons with single slash
  return {
    path: candidate,
    line: parseInt(m[2], 10),
    column: m[3] ? parseInt(m[3], 10) : undefined,
  };
}

export function parseOne(rawInput: string): ParsedPath | null {
  const cleaned = cleanCandidate(rawInput);
  if (!cleaned) return null;

  // URLs
  if (/^https?:\/\/\S+$/i.test(cleaned)) {
    return {
      raw: rawInput,
      input: cleaned,
      absolute: "",
      isUrl: true,
      url: cleaned,
      exists: false,
      isDirectory: false,
      isFile: false,
      category: "url",
      extension: "",
    };
  }

  // SSH / VPS: ssh://[user@]host[:port]/path  or  [user@]host:/path (scp style)
  const remote = parseRemote(cleaned);
  if (remote) {
    const ext = extname(remote.path);
    let category = classify(ext, false, remote.path);
    // No extension on a remote path almost always means a folder — we can't stat it.
    if (category === "unknown" && !ext) category = "directory";
    return {
      raw: rawInput,
      input: cleaned,
      absolute: remote.path,
      line: remote.line,
      column: remote.column,
      isUrl: false,
      remote: remote.info,
      exists: false,
      isDirectory: category === "directory",
      isFile: category !== "directory",
      category,
      extension: ext.toLowerCase(),
    };
  }

  let s = cleaned;
  if (s.startsWith("file://")) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
    } catch {
      s = s.replace(/^file:\/\//, "");
    }
  } else {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* keep raw */
    }
  }

  const { path: pathPart, line, column } = splitLineCol(s);
  const expanded = expandHome(pathPart);

  // Relative paths: try home first (most copied paths are home-relative or absolute),
  // then Raycast's cwd-agnostic resolve. We keep home as base because extensions
  // have no meaningful cwd.
  const absolute = isAbsolute(expanded)
    ? expanded
    : resolve(homedir(), expanded);

  let exists = false,
    isDirectory = false,
    isFile = false;
  try {
    exists = existsSync(absolute);
    if (exists) {
      const st = statSync(absolute);
      isDirectory = st.isDirectory();
      isFile = st.isFile();
    }
  } catch {
    /* treat as missing */
  }

  const ext = extname(absolute);
  const category = classify(ext, isDirectory, absolute);

  return {
    raw: rawInput,
    input: cleaned,
    absolute,
    line,
    column,
    isUrl: false,
    exists,
    isDirectory,
    isFile,
    category,
    extension: ext.toLowerCase(),
  };
}

/**
 * Extract candidate paths from arbitrary selected text.
 * - One candidate per line if multiline
 * - If a single line contains prose, pull out the first path-like token
 */
export function extractCandidates(text: string): ParsedPath[] {
  if (!text?.trim()) return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ParsedPath[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Fast path: whole line is a path / URL. A line with spaces is prose,
    // not a path — unless it exists on disk (filenames can contain spaces).
    const whole = parseOne(line);
    const cleanedLine = cleanCandidate(line);
    const isSingleToken = !/\s/.test(cleanedLine);
    if (
      whole &&
      (whole.isUrl ||
        whole.remote ||
        whole.exists ||
        (isSingleToken && looksLikePath(cleanedLine)))
    ) {
      const key = whole.isUrl
        ? whole.url!
        : whole.remote
          ? `${whole.remote.target}:${whole.absolute}`
          : whole.absolute;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(whole);
      }
      continue;
    }
    // Prose fallback: try each whitespace-separated word as a candidate
    // (covers user@host:/path which has no leading ~ or /), plus glued tokens.
    const wordTokens = line.split(/\s+/).map((w) => cleanCandidate(w));
    const gluedTokens =
      line.match(/(?:~|\$HOME|\/|\.|https?:\/\/)[^\s"'`<>]+/g) ?? [];
    const tokens = [...wordTokens, ...gluedTokens];
    for (const tok of tokens) {
      const p = parseOne(tok);
      if (p && (p.isUrl || p.remote || p.exists)) {
        const key = p.isUrl
          ? p.url!
          : p.remote
            ? `${p.remote.target}:${p.absolute}`
            : p.absolute;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(p);
        }
      }
    }
  }
  // If nothing matched but user gave a single token, surface it anyway (for Create/Open missing path UI)
  if (out.length === 0 && lines.length === 1) {
    const p = parseOne(lines[0]);
    if (p && looksLikePath(cleanCandidate(lines[0]))) out.push(p);
  }
  return out;
}

function looksLikePath(s: string): boolean {
  if (/^https?:\/\//i.test(s)) return true;
  if (/^ssh:\/\//i.test(s)) return true;
  if (/^(?:[^@/\s]+@)?[A-Za-z0-9._-]+:\//.test(s)) return true;
  if (
    s.startsWith("~/") ||
    s.startsWith("/") ||
    s.startsWith("$HOME") ||
    s.startsWith("./") ||
    s.startsWith("../")
  )
    return true;
  // filename with extension, e.g. settings.json, image.png, folder/file.ts:42
  if (/^[^\s]+\.[a-z0-9]{1,10}(?::\d+(?::\d+)?)?$/i.test(s)) return true;
  if (s.includes("/")) return true;
  return false;
}

/** First real Host alias from ~/.ssh/config (skips wildcards), if any. */
export function firstSshConfigHost(): string | undefined {
  try {
    const cfg = readFileSync(join(homedir(), ".ssh", "config"), "utf8");
    for (const line of cfg.split(/\r?\n/)) {
      const m = line.trim().match(/^Host\s+(.+)$/i);
      if (!m) continue;
      const name = m[1]
        .split(/\s+/)
        .find((h) => !h.includes("*") && !h.includes("?"));
      if (name) return name;
    }
  } catch {
    // No ssh config — no default host.
  }
  return undefined;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  code: "Code / Text",
  directory: "Folder",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  archive: "Archive",
  app: "App",
  url: "URL",
  unknown: "File",
};
