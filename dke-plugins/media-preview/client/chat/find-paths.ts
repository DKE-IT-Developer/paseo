import { type MediaKind, fileKind } from "../../shared/kinds";

export interface FoundMediaPath {
  path: string;
  kind: MediaKind;
}

// Alternatives, leftmost match wins: file:// URL | `backtick span` | markdown link target | bare path.
// Bare paths must not follow a word char, ":", "/", "." or "~" so URLs and relative paths are skipped.
const SCAN =
  /(file:\/\/[^\s`<>)\]"']+)|`([^`\n]+)`|\]\(\s*(?:<([^>\n]+)>|([^)\s]+))\s*\)|(?<![\w:/.~-])((?:~\/|\/)[^\s`"'<>[\]]+)/g;

const TRAILING = /[.,;:!?)}\]'"]+$/;

function fromFileUrl(raw: string): string | null {
  let rest = raw.slice("file://".length).replace(/^localhost(?=\/)/, "");
  rest = rest.replace(TRAILING, "");
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return rest;
}

/** Markdown link targets are URLs: the host decodes their escapes, so the card must too. */
function decodeLinkTarget(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function accept(candidate: string | null, seen: Set<string>, out: FoundMediaPath[]): void {
  if (!candidate) return;
  const path = candidate.trim();
  if (!path.startsWith("/") && !path.startsWith("~/")) return;
  // A segment that is only "..." or "…" is an example placeholder, not a real file.
  if (path.split("/").some((segment) => segment === "..." || segment === "…")) return;
  const kind = fileKind(path);
  if (!kind || seen.has(path)) return;
  seen.add(path);
  out.push({ path, kind });
}

export function findMediaPaths(text: string): FoundMediaPath[] {
  const out: FoundMediaPath[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(SCAN)) {
    const [, fileUrl, tick, angle, plainLink, bare] = match;
    if (fileUrl) accept(fromFileUrl(fileUrl), seen, out);
    else if (tick !== undefined) accept(tick, seen, out);
    else if (angle !== undefined) accept(decodeLinkTarget(angle), seen, out);
    else if (plainLink !== undefined) {
      accept(decodeLinkTarget(plainLink.replace(TRAILING, "")), seen, out);
    } else if (bare) accept(bare.replace(TRAILING, ""), seen, out);
  }
  return out;
}
