import { constants } from "node:fs";
import { open, realpath, stat, lstat, unlink, link, access } from "node:fs/promises";
import { dirname, basename, relative, isAbsolute, resolve, join, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Quady3D } from "@quady3d/sdk";
import { LocalError } from "./errors.js";

const inside = (root: string, target: string) => { const tail = relative(root, target); return tail === "" || (!tail.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && tail !== ".." && !isAbsolute(tail)); };
const maximumImage = 8 * 1024 * 1024;
const permittedExtensions = new Set([".glb", ".gltf", ".obj", ".fbx", ".stl", ".ply", ".usdz", ".zip", ".3mf", ".png", ".jpg", ".jpeg", ".webp", ".bin", ".mtl"]);

export class ProjectFiles {
  private constructor(private roots: string[], private privateDirectory: string, private rootIdentities: Map<string, { dev: number; ino: number }>) {}
  static async create(roots: string[], privateDirectory: string) {
    try {
      const resolved = await Promise.all(roots.map(root => realpath(root)));
      const identities = new Map<string, { dev: number; ino: number }>();
      for (const root of resolved) {
        const info = await stat(root);
        if (!info.isDirectory() || inside(root, privateDirectory)) throw new Error("Choose a project directory");
        identities.set(root, { dev: info.dev, ino: info.ino });
      }
      return new ProjectFiles([...new Set(resolved)], privateDirectory, identities);
    } catch { throw new LocalError("invalid_workspace", "Choose existing project directories that do not contain the MCP private state directory."); }
  }

  private async writableRoot(root: string) {
    try {
      const actual = await realpath(root), current = await lstat(root), initial = this.rootIdentities.get(root)!;
      if (actual !== root || current.isSymbolicLink() || !current.isDirectory() || current.dev !== initial.dev || current.ino !== initial.ino) throw new LocalError("workspace_changed", "The selected project directory changed. Check the directory and restart the connection before starting a new generation.");
      await access(root, constants.W_OK | constants.X_OK);
    } catch (error) {
      if (error instanceof LocalError) throw error;
      throw new LocalError("workspace_unavailable", "The selected project directory is unavailable or cannot receive files. Check its location and permissions before starting a new generation.");
    }
  }

  async workspace() {
    const ready: string[] = [];
    let issue = { code: "workspace_required", message: "Choose an existing project directory with --root or QUADY3D_ALLOWED_ROOTS before starting a new generation." };
    for (const root of this.roots) {
      try { await this.writableRoot(root); ready.push(root); }
      catch (error) { if (!(error instanceof LocalError)) throw error; issue = { code: error.code, message: error.message }; }
    }
    return { allowed_roots: [...this.roots], ready_roots: ready, ready_for_new_generation: ready.length > 0, ...(ready.length ? {} : { error: issue }) };
  }

  async requireGenerationWorkspace() {
    const workspace = await this.workspace();
    if (!workspace.ready_for_new_generation) throw new LocalError(workspace.error!.code, workspace.error!.message);
  }

  private permitted(path: string) {
    if (!this.roots.length) throw new LocalError("workspace_required", "Configure --root or QUADY3D_ALLOWED_ROOTS with the project directory before reading or saving files.");
    if (!this.roots.some(root => inside(root, path)) || inside(this.privateDirectory, path)) throw new LocalError("path_not_allowed", "Choose a file inside an allowed project directory.");
  }
  private absolute(path: string) {
    if (!path || path.length > 4096 || path.includes("\0")) throw new LocalError("invalid_path", "Choose a valid project file path.");
    if (!isAbsolute(path) && this.roots.length !== 1) throw new LocalError("invalid_path", "Use an absolute file path when multiple project directories are configured.");
    return resolve(this.roots[0] ?? ".", path);
  }
  private async checkedParent(path: string) {
    const requested = dirname(this.absolute(path));
    let parent;
    try { parent = await realpath(requested); } catch { throw new LocalError("directory_not_found", "Create the destination directory in your project, then save the asset there."); }
    this.permitted(parent);
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new LocalError("path_not_allowed", "Choose an existing project directory.");
    return { path: parent, dev: info.dev, ino: info.ino };
  }
  private async recheck(parent: { path: string; dev: number; ino: number }) {
    const actual = await realpath(parent.path);
    const current = await lstat(parent.path);
    this.permitted(actual);
    if (actual !== parent.path || current.isSymbolicLink() || current.dev !== parent.dev || current.ino !== parent.ino) throw new LocalError("workspace_changed", "The project directory changed during this operation. Retry the same file operation after checking the directory.");
  }

  async image(path: string) {
    const absolute = this.absolute(path);
    let actual;
    try { actual = await realpath(absolute); } catch { throw new LocalError("file_not_found", "Choose an existing PNG, JPG or WebP file in your project."); }
    this.permitted(actual);
    const parent = await this.checkedParent(actual);
    let handle;
    try {
      handle = await open(actual, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const initial = await handle.stat();
      if (!initial.isFile() || initial.size < 1 || initial.size > maximumImage) throw new LocalError("invalid_image", "Choose one PNG, JPG or WebP image up to 8 MiB.");
      await this.recheck(parent);
      const current = await lstat(actual);
      if (current.dev !== initial.dev || current.ino !== initial.ino || current.isSymbolicLink()) throw new LocalError("file_changed", "The selected image changed. Select it again.");
      const bytes = Buffer.alloc(maximumImage + 1);
      let size = 0;
      while (size < bytes.length) { const chunk = await handle.read(bytes, size, bytes.length - size); if (!chunk.bytesRead) break; size += chunk.bytesRead; }
      const final = await handle.stat();
      await this.recheck(parent);
      if (size !== initial.size || size > maximumImage || final.mtimeMs !== initial.mtimeMs) throw new LocalError("file_changed", "The selected image changed. Select it again.");
      const data = bytes.subarray(0, size);
      const type = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
        : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "image/jpeg"
        : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
      if (!type) throw new LocalError("invalid_image", "Choose a PNG, JPG or WebP image.");
      return { data, type } as const;
    } catch (error) {
      if (error instanceof LocalError) throw error;
      throw new LocalError("file_read_failed", "Could not read the selected image. Check the file and project permissions.");
    } finally { await handle?.close(); }
  }

  async download(client: Quady3D, assetId: string, targetPath: string, signal?: AbortSignal) {
    const absolute = this.absolute(targetPath);
    const extension = extname(absolute).toLowerCase();
    if (!permittedExtensions.has(extension)) throw new LocalError("unsupported_file_name", "Use the actual model, archive or texture file extension shown by the task.");
    const parent = await this.checkedParent(absolute);
    const target = join(parent.path, basename(absolute));
    this.permitted(target);
    try { await lstat(target); throw new LocalError("file_exists", "A file already exists at this location. Choose a different filename."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = join(parent.path, `.quady3d-${randomUUID()}.part`);
    let handle;
    try {
      await this.recheck(parent);
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
      const digest = createHash("sha256");
      const metadata = await client.downloadAsset(assetId, { signal, write: async chunk => {
        await this.recheck(parent);
        let offset = 0;
        while (offset < chunk.byteLength) { const { bytesWritten } = await handle!.write(chunk, offset, chunk.byteLength - offset); if (!bytesWritten) throw new Error("Write stopped"); offset += bytesWritten; }
        digest.update(chunk);
      } });
      await handle.sync();
      const info = await handle.stat();
      if (info.size !== metadata.byteSize) throw new LocalError("download_incomplete", "The saved file size does not match the download. Retry this asset download.");
      if (extension === ".glb") {
        const header = Buffer.alloc(12);
        const { bytesRead } = await handle.read(header, 0, 12, 0);
        if (bytesRead !== 12 || header.toString("ascii", 0, 4) !== "glTF" || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== info.size) throw new LocalError("invalid_model_file", "This file does not have a complete GLB 2 header. Retry the download or check the task result.");
      }
      if (signal?.aborted) throw new LocalError("request_cancelled", "The local download stopped. Resume this asset download.");
      await this.recheck(parent);
      const current = await lstat(temporary);
      if (current.dev !== info.dev || current.ino !== info.ino || current.isSymbolicLink()) throw new LocalError("workspace_changed", "The temporary file changed. Retry this asset download.");
      // link() publishes without replacing an existing name; rename() would overwrite it.
      try { await link(temporary, target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LocalError("file_exists", "A file appeared at the destination. Choose a different filename.");
        throw error;
      }
      await this.recheck(parent);
      const result = await lstat(target);
      if (!result.isFile() || result.ino !== info.ino || result.dev !== info.dev) throw new LocalError("workspace_changed", "Check the destination file before retrying this download.");
      return { path: target, byte_size: info.size, content_type: metadata.contentType, format: extension.slice(1), sha256: digest.digest("hex"), sha256_source: "local" as const, glb_header_checked: extension === ".glb" };
    } finally {
      const owned = await handle?.stat().catch(() => undefined);
      await handle?.close();
      if (owned) {
        // A renamed/replaced directory must never redirect cleanup into another tree.
        await this.recheck(parent).then(async () => {
          const current = await lstat(temporary);
          if (current.dev === owned.dev && current.ino === owned.ino && !current.isSymbolicLink()) await unlink(temporary);
        }).catch(() => undefined);
      }
    }
  }
}
