import { Clipboard, getSelectedText } from "@raycast/api";
import { extractCandidates } from "./parse";
import type { ParsedPath } from "./types";

/**
 * Resolution order: explicit argument > selected text > clipboard (if enabled).
 * getSelectedText can throw when nothing is selected or the front app
 * doesn't support it — that's normal, we just fall through.
 */
export async function getCandidates(opts: {
  argument?: string;
  fallbackToClipboard: boolean;
}): Promise<{
  candidates: ParsedPath[];
  source: "argument" | "selection" | "clipboard" | "none";
  raw: string;
}> {
  if (opts.argument?.trim()) {
    return {
      candidates: extractCandidates(opts.argument),
      source: "argument",
      raw: opts.argument,
    };
  }
  try {
    const selected = await getSelectedText();
    if (selected?.trim()) {
      const candidates = extractCandidates(selected);
      if (candidates.length)
        return { candidates, source: "selection", raw: selected };
      // Selection had text but no path in it — still report it so UI can say so,
      // unless clipboard fallback might do better.
      if (!opts.fallbackToClipboard)
        return { candidates, source: "selection", raw: selected };
    }
  } catch {
    // No selection available — fall through to clipboard.
  }
  if (opts.fallbackToClipboard) {
    try {
      const clip = await Clipboard.readText();
      if (clip?.trim()) {
        const candidates = extractCandidates(clip);
        if (candidates.length)
          return { candidates, source: "clipboard", raw: clip };
      }
    } catch {
      // Clipboard unreadable — nothing more to try.
    }
  }
  return { candidates: [], source: "none", raw: "" };
}
