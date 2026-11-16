/** Encodes one path segment so a Markdown link destination needs no angle brackets. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Percent-encoded Markdown link to a file. The host opens explicit Markdown links after
 * decoding URL escapes; an angle-bracket destination with raw spaces does not open (seen in
 * the 0.15.4 web app).
 */
export function fileLinkMarkdown(path: string): string {
  const home = path.startsWith("~/");
  const rest = home ? path.slice(1) : path;
  const encoded = rest.split("/").map(encodeSegment).join("/");
  return `[Buka di panel](${home ? "~" : ""}${encoded})`;
}
