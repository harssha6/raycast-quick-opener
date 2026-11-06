import { getPreferenceValues, showHUD, showToast, Toast } from "@raycast/api";
import { getCandidates } from "./lib/source";
import { openPrimary } from "./lib/openers";
import type { Preferences } from "./lib/types";

export default async function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const { candidates, source } = await getCandidates({
    fallbackToClipboard: prefs.fallbackToClipboard,
  });

  if (candidates.length === 0) {
    await showToast({
      style: Toast.Style.Failure,
      title: "No path found",
      message: "Select a path, copy one, or use Open Path...",
    });
    return;
  }

  // Single clean hit: open it instantly. That's the whole point of this command.
  // Multiple / missing paths: don't guess — tell the user to use the list UI.
  if (candidates.length > 1) {
    await showHUD(
      `Found ${candidates.length} paths — use “Open Path...” to pick one`,
    );
    return;
  }

  const target = candidates[0];

  if (!target.isUrl && !target.remote && !target.exists) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Path doesn't exist",
      message: target.absolute,
    });
    return;
  }

  try {
    const app = await openPrimary(target, prefs);
    const where = source === "clipboard" ? " (from clipboard)" : "";
    await showHUD(
      `Opened in ${app}${where}: ${target.remote ? `${target.remote.target}:${target.remote.path}` : shorten(target.isUrl ? target.url! : target.absolute)}`,
    );
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Couldn't open path",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function shorten(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}
