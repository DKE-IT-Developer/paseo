/** Single source of truth for media kinds; the chat message schema derives its enum from it. */
export const MEDIA_KINDS = ["audio", "video", "pdf", "office", "sheet"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const EXTENSIONS: Record<MediaKind, readonly string[]> = {
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus"],
  video: ["mp4", "m4v", "webm", "mov", "ogv"],
  pdf: ["pdf"],
  office: ["docx", "doc", "odt", "rtf", "pptx", "ppt", "odp"],
  sheet: ["xlsx", "xls", "ods"],
};

export function fileKind(path: string): MediaKind | null {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  for (const kind of MEDIA_KINDS) {
    if (EXTENSIONS[kind].includes(ext)) return kind;
  }
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  odp: "application/vnd.oasis.opendocument.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

export function mimeForPath(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_BY_EXT[base.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}
