export type EditorId = "zed" | "vscode" | "cursor" | "textedit";
export type MediaMode = "quicklook" | "preview" | "default";
export type SshTerminal = "terminal" | "iterm";

export interface Preferences {
  editor: EditorId;
  mediaMode: MediaMode;
  fallbackToClipboard: boolean;
  sshTerminal: SshTerminal;
  defaultSshHost?: string;
}

export interface RemoteInfo {
  /** user@host or just host, as given */
  target: string;
  host: string;
  user?: string;
  port?: number;
  /** Absolute path on the remote machine */
  path: string;
}

export type Category =
  | "code"
  | "directory"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "archive"
  | "app"
  | "url"
  | "unknown";

export interface ParsedPath {
  /** Raw cleaned input, e.g. ~/Projects/demo/README.md:12 */
  raw: string;
  /** Absolute filesystem path (empty for URLs) */
  absolute: string;
  /** Original input before resolution */
  input: string;
  line?: number;
  column?: number;
  isUrl: boolean;
  url?: string;
  remote?: RemoteInfo;
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  category: Category;
  extension: string;
}
