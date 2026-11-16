import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileKind } from "../shared/kinds";
import { PathNotAllowedError, allowedRoots, resolveAllowedPath } from "./paths";

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "dke-paths-")));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("resolveAllowedPath", () => {
  it("resolves file inside root", async () => {
    const file = path.join(root, "a.mp3");
    await writeFile(file, "x");
    expect(await resolveAllowedPath(file, [root])).toBe(await realpath(file));
  });

  it("resolves file with spaces and unicode", async () => {
    const file = path.join(root, "rapat (final) é.docx");
    await writeFile(file, "x");
    expect(await resolveAllowedPath(file, [root])).toBe(await realpath(file));
  });

  it("rejects ../ traversal", async () => {
    const secret = path.join(outside, "secret.pdf");
    await writeFile(secret, "x");
    await expect(
      resolveAllowedPath(path.join(root, "..", "outside", "secret.pdf"), [root]),
    ).rejects.toBeInstanceOf(PathNotAllowedError);
  });

  it("rejects symlink escaping root", async () => {
    const secret = path.join(outside, "secret.pdf");
    await writeFile(secret, "x");
    const link = path.join(root, "link.pdf");
    await symlink(secret, link);
    await expect(resolveAllowedPath(link, [root])).rejects.toBeInstanceOf(PathNotAllowedError);
  });

  it("rejects sibling directory sharing the root prefix", async () => {
    const sibling = path.join(base, "root-evil");
    await mkdir(sibling);
    const file = path.join(sibling, "a.pdf");
    await writeFile(file, "x");
    await expect(resolveAllowedPath(file, [root])).rejects.toBeInstanceOf(PathNotAllowedError);
  });

  it("rejects nonexistent file as not allowed", async () => {
    await expect(resolveAllowedPath(path.join(root, "nope.pdf"), [root])).rejects.toBeInstanceOf(
      PathNotAllowedError,
    );
  });
});

describe("allowedRoots", () => {
  it("includes tmp, private tmp, Downloads, Desktop, Documents and workspace dirs", () => {
    const roots = allowedRoots(["/work/space"], "/Users/someone");
    expect(roots).toEqual(
      expect.arrayContaining([
        "/work/space",
        "/tmp",
        "/private/tmp",
        "/Users/someone/Downloads",
        "/Users/someone/Desktop",
        "/Users/someone/Documents",
      ]),
    );
  });
});

describe("fileKind", () => {
  it("maps extensions case-insensitively", () => {
    expect(fileKind("A.MP3")).toBe("audio");
    expect(fileKind("/x/y/deck.pptx")).toBe("office");
    expect(fileKind("x.csv")).toBeNull();
    expect(fileKind("noext")).toBeNull();
  });
});
