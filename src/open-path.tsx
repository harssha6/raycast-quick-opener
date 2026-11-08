import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  Toast,
  getPreferenceValues,
  showInFinder,
  showToast,
  trash,
  Keyboard,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname } from "path";
import { getCandidates } from "./lib/source";
import {
  downloadRemote,
  openInEditor,
  openInPreview,
  openPrimary,
  openRemoteInEditor,
  openSshTerminal,
  openWithDefault,
  quickLook,
  revealInFinder,
} from "./lib/openers";
import { CATEGORY_LABEL, firstSshConfigHost } from "./lib/parse";
import { sshCommand } from "./lib/ssh";
import type { ParsedPath, Preferences } from "./lib/types";

interface Args {
  arguments: { path?: string };
}

export default function Command(props: Args) {
  const prefs = getPreferenceValues<Preferences>();
  const [items, setItems] = useState<ParsedPath[]>([]);
  const [source, setSource] = useState<string>("");
  const [raw, setRaw] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await getCandidates({
        argument: props.arguments.path,
        fallbackToClipboard: prefs.fallbackToClipboard,
      });
      setItems(result.candidates);
      setSource(result.source);
      setRaw(result.raw);
      setIsLoading(false);
    })();
  }, [props.arguments.path, prefs.fallbackToClipboard]);

  async function refresh() {
    const result = await getCandidates({
      argument: props.arguments.path,
      fallbackToClipboard: prefs.fallbackToClipboard,
    });
    setItems(result.candidates);
    setSource(result.source);
    setRaw(result.raw);
  }

  if (!isLoading && items.length === 0) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No path found"
          description={
            raw.trim()
              ? `Selection didn't contain a path: “${truncate(raw.trim(), 80)}”. Copy a path and retry, or pass one as an argument.`
              : "Select a path in any app, copy one to the clipboard, or pass a path as an argument to this command."
          }
          actions={
            <ActionPanel>
              <Action
                title="Re-Check Selection / Clipboard"
                icon={Icon.ArrowClockwise}
                onAction={refresh}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter paths...">
      <List.Section
        title={
          source === "clipboard"
            ? "From clipboard"
            : source === "argument"
              ? "From argument"
              : "From selection"
        }
        subtitle={`${items.length} path${items.length === 1 ? "" : "s"}`}
      >
        {items.map((item) => (
          <PathItem
            key={
              item.isUrl
                ? item.url
                : item.remote
                  ? `${item.remote.target}:${item.absolute}`
                  : item.absolute
            }
            item={item}
            prefs={prefs}
            onMutate={refresh}
          />
        ))}
      </List.Section>
    </List>
  );
}

function PathItem({
  item,
  prefs,
  onMutate,
}: {
  item: ParsedPath;
  prefs: Preferences;
  onMutate: () => void;
}) {
  const display = item.isUrl
    ? item.url!
    : item.remote
      ? `${item.remote.target}:${item.remote.path}`
      : item.absolute;
  const name = item.isUrl
    ? item.url!
    : basename(item.absolute) || item.absolute;
  const detail = describe(item);

  return (
    <List.Item
      icon={iconFor(item)}
      title={name}
      subtitle={display !== name ? display : undefined}
      accessories={detail ? [{ text: detail }] : []}
      keywords={[item.category, item.extension, display]}
      actions={
        <ActionPanel>
          {item.exists || item.isUrl || item.remote ? (
            <>
              <Action
                title={primaryTitle(item, prefs)}
                icon={Icon.ArrowRight}
                onAction={() =>
                  run(() => openPrimary(item, prefs), `Opened ${name}`)
                }
              />
              {item.remote &&
                (item.category === "image" ||
                  item.category === "video" ||
                  item.category === "audio" ||
                  item.category === "pdf") && (
                  <Action
                    title="Download & Quick Look"
                    icon={Icon.Eye}
                    shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                    onAction={() =>
                      run(async () => {
                        const local = await downloadRemote(item);
                        quickLook({ ...item, absolute: local });
                      }, "Downloaded")
                    }
                  />
                )}
              {item.remote && (
                <>
                  <Action
                    title={`Open Remotely in ${label(prefs.editor)}`}
                    icon={Icon.Code}
                    shortcut={Keyboard.Shortcut.Common.Edit}
                    onAction={() =>
                      run(
                        () => openRemoteInEditor(item, prefs),
                        "Opened remotely",
                      )
                    }
                  />
                  <Action
                    title="SSH Terminal Here"
                    icon={Icon.Terminal}
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
                    onAction={() =>
                      run(() => openSshTerminal(item, prefs), "SSH opened")
                    }
                  />
                  <Action
                    title="Copy SSH Command"
                    icon={Icon.Clipboard}
                    onAction={async () => {
                      await Clipboard.copy(
                        sshCommand(
                          item.remote!.target,
                          item.isDirectory
                            ? item.remote!.path
                            : dirname(item.remote!.path),
                          item.remote!.port,
                        ),
                      );
                    }}
                  />
                </>
              )}
              {!item.remote &&
                (item.category === "image" ||
                  item.category === "video" ||
                  item.category === "audio" ||
                  item.category === "pdf") && (
                  <Action
                    title="Quick Look"
                    icon={Icon.Eye}
                    shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                    onAction={() => {
                      quickLook(item);
                      showToast({
                        style: Toast.Style.Success,
                        title: "Quick Look",
                      });
                    }}
                  />
                )}
              {!item.remote && item.isFile && (
                <Action
                  title={`Open in Editor (${label(prefs.editor)})`}
                  icon={Icon.Code}
                  shortcut={Keyboard.Shortcut.Common.Edit}
                  onAction={() =>
                    run(
                      () => openInEditor(item, prefs.editor),
                      `Opened in ${label(prefs.editor)}`,
                    )
                  }
                />
              )}
              {!item.remote && !item.isUrl && item.category === "image" && (
                <Action
                  title="Open in Preview"
                  icon={Icon.Image}
                  onAction={() =>
                    run(() => openInPreview(item), "Opened in Preview")
                  }
                />
              )}
              {!item.remote && !item.isUrl && (
                <Action
                  title="Reveal in Finder"
                  icon={Icon.Finder}
                  shortcut={{ modifiers: ["cmd"], key: "f" }}
                  onAction={() =>
                    run(() => revealInFinder(item), "Revealed in Finder")
                  }
                />
              )}
              {!item.remote && (
                <Action
                  title="Open with Default App"
                  icon={Icon.AppWindow}
                  onAction={() => run(() => openWithDefault(item), "Opened")}
                />
              )}
              <ActionPanel.Section>
                <Action
                  title="Copy Path"
                  icon={Icon.Clipboard}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                  onAction={async () => {
                    await Clipboard.copy(display);
                    await showToast({
                      style: Toast.Style.Success,
                      title: "Copied path",
                    });
                  }}
                />
                {item.line && (
                  <Action
                    title="Copy Path with Line"
                    icon={Icon.Clipboard}
                    onAction={async () => {
                      await Clipboard.copy(
                        `${item.absolute}:${item.line}${item.column ? `:${item.column}` : ""}`,
                      );
                    }}
                  />
                )}
              </ActionPanel.Section>
              {!item.isUrl && item.exists && (
                <ActionPanel.Section>
                  <Action
                    title="Move to Trash"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={async () => {
                      await trash(item.absolute);
                      await showToast({
                        style: Toast.Style.Success,
                        title: "Moved to Trash",
                      });
                      onMutate();
                    }}
                  />
                </ActionPanel.Section>
              )}
            </>
          ) : (
            <>
              {(prefs.defaultSshHost?.trim() || firstSshConfigHost()) && (
                <Action
                  title={`Open Remotely (${prefs.defaultSshHost?.trim() || firstSshConfigHost()})`}
                  icon={Icon.Globe}
                  onAction={() =>
                    run(
                      () =>
                        openPrimary(
                          {
                            ...item,
                            remote: {
                              target: (prefs.defaultSshHost?.trim() ||
                                firstSshConfigHost())!,
                              host: (prefs.defaultSshHost?.trim() ||
                                firstSshConfigHost())!,
                              path: item.absolute,
                            },
                          },
                          prefs,
                        ),
                      "Opened on VPS",
                    )
                  }
                />
              )}
              <Action
                title="Create File & Open in Editor"
                icon={Icon.NewDocument}
                onAction={async () => {
                  try {
                    mkdirSync(dirname(item.absolute), { recursive: true });
                    if (!existsSync(item.absolute))
                      writeFileSync(item.absolute, "");
                    await openInEditor(item, prefs.editor);
                    await showToast({
                      style: Toast.Style.Success,
                      title: "Created and opened",
                    });
                    onMutate();
                  } catch (e) {
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Couldn't create file",
                      message: String(e),
                    });
                  }
                }}
              />
              <Action
                title="Copy Path"
                icon={Icon.Clipboard}
                onAction={async () => {
                  await Clipboard.copy(display);
                }}
              />
              <Action
                title="Reveal Parent Folder in Finder"
                icon={Icon.Finder}
                onAction={async () => {
                  if (existsSync(dirname(item.absolute)))
                    await showInFinder(dirname(item.absolute));
                }}
              />
            </>
          )}
          <Action
            title="Re-Check Selection / Clipboard"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={onMutate}
          />
        </ActionPanel>
      }
    />
  );
}

function primaryTitle(item: ParsedPath, prefs: Preferences): string {
  if (item.isUrl) return "Open URL in Browser";
  if (item.remote) {
    if (item.category === "directory")
      return `Open Remote Folder in ${label(prefs.editor)}`;
    if (item.category === "code")
      return `Open in ${label(prefs.editor)} via SSH${item.line ? ` at Line ${item.line}` : ""}`;
    if (["image", "video", "audio", "pdf"].includes(item.category))
      return "Download & Quick Look";
    return "SSH Terminal Here";
  }
  switch (item.category) {
    case "directory":
      return "Open Folder in Finder";
    case "code":
      return `Open in ${label(prefs.editor)}${item.line ? ` at Line ${item.line}` : ""}`;
    case "image":
    case "video":
    case "audio":
      return prefs.mediaMode === "quicklook" ? "Quick Look" : "Open Media";
    case "pdf":
      return prefs.mediaMode === "quicklook" ? "Quick Look" : "Open in Preview";
    case "app":
      return "Launch App";
    default:
      return "Reveal in Finder";
  }
}

function iconFor(item: ParsedPath): Icon {
  if (item.remote) return Icon.Globe;
  if (!item.exists && !item.isUrl) return Icon.QuestionMark;
  switch (item.category) {
    case "directory":
      return Icon.Folder;
    case "code":
      return Icon.Code;
    case "image":
      return Icon.Image;
    case "video":
      return Icon.Video;
    case "audio":
      return Icon.Music;
    case "pdf":
      return Icon.Document;
    case "archive":
      return Icon.Box;
    case "app":
      return Icon.AppWindow;
    case "url":
      return Icon.Link;
    default:
      return Icon.Document;
  }
}

function describe(item: ParsedPath): string {
  if (item.remote)
    return `SSH · ${CATEGORY_LABEL[item.category]}${item.line ? ` · line ${item.line}` : ""}`;
  if (item.isUrl) return "URL";
  if (!item.exists) return "Not found";
  try {
    const st = statSync(item.absolute);
    const size = item.isDirectory
      ? CATEGORY_LABEL[item.category]
      : `${CATEGORY_LABEL[item.category]} · ${formatSize(st.size)}`;
    const when = st.mtime.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return item.line ? `${size} · line ${item.line}` : `${size} · ${when}`;
  } catch {
    return CATEGORY_LABEL[item.category];
  }
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function label(editor: Preferences["editor"]): string {
  return {
    zed: "Zed",
    vscode: "VS Code",
    cursor: "Cursor",
    textedit: "TextEdit",
  }[editor];
}

async function run(fn: () => Promise<unknown>, title: string) {
  try {
    await fn();
    await showToast({ style: Toast.Style.Success, title });
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
