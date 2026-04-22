const ROOT_DIR = "transcripter-chunks";

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof window === "undefined" || !("storage" in navigator)) {
    throw new Error("OPFS only available in browser");
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function getSessionDir(sessionId: string): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  return root.getDirectoryHandle(sessionId, { create: true });
}

export type ChunkMeta = {
  sessionId: string;
  chunkId: string;   // deterministic: `${sessionId}-${index}`
  index: number;
  size: number;
  mimeType: string;
  createdAt: number;
  acked: boolean;
};

const META_FILE = "_meta.json";

async function readMeta(sessionId: string): Promise<Record<string, ChunkMeta>> {
  try {
    const dir = await getSessionDir(sessionId);
    const fh = await dir.getFileHandle(META_FILE, { create: false });
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return {};
  }
}

async function writeMeta(
  sessionId: string,
  meta: Record<string, ChunkMeta>,
): Promise<void> {
  const dir = await getSessionDir(sessionId);
  const fh = await dir.getFileHandle(META_FILE, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

export const opfs = {
  async writeChunk(
    sessionId: string,
    index: number,
    blob: Blob,
  ): Promise<ChunkMeta> {
    const dir = await getSessionDir(sessionId);
    const chunkId = `${sessionId}-${index.toString().padStart(6, "0")}`;
    const fileName = `${chunkId}.bin`;

    const fh = await dir.getFileHandle(fileName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();

    const meta = await readMeta(sessionId);
    const entry: ChunkMeta = {
      sessionId,
      chunkId,
      index,
      size: blob.size,
      mimeType: blob.type || "application/octet-stream",
      createdAt: Date.now(),
      acked: false,
    };
    meta[chunkId] = entry;
    await writeMeta(sessionId, meta);
    return entry;
  },

  async readChunk(sessionId: string, chunkId: string): Promise<Blob> {
    const dir = await getSessionDir(sessionId);
    const fh = await dir.getFileHandle(`${chunkId}.bin`, { create: false });
    const file = await fh.getFile();
    return file;
  },

  async markAcked(sessionId: string, chunkId: string): Promise<void> {
    const meta = await readMeta(sessionId);
    if (meta[chunkId]) {
      meta[chunkId].acked = true;
      await writeMeta(sessionId, meta);
    }
  },

  async listChunks(sessionId: string): Promise<ChunkMeta[]> {
    const meta = await readMeta(sessionId);
    return Object.values(meta).sort((a, b) => a.index - b.index);
  },

  async listPending(sessionId: string): Promise<ChunkMeta[]> {
    return (await opfs.listChunks(sessionId)).filter((c) => !c.acked);
  },

  async deleteChunk(sessionId: string, chunkId: string): Promise<void> {
    const dir = await getSessionDir(sessionId);
    try {
      await dir.removeEntry(`${chunkId}.bin`);
    } catch {
      /* ignore if already removed */
    }
    const meta = await readMeta(sessionId);
    delete meta[chunkId];
    await writeMeta(sessionId, meta);
  },

  async clearSession(sessionId: string): Promise<void> {
    const root = await getRoot();
    try {
      await root.removeEntry(sessionId, { recursive: true });
    } catch {
      /* ignore */
    }
  },

  async listSessions(): Promise<string[]> {
  // ✅ Prevent execution during SSR / build
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const root = await getRoot();
    const ids: string[] = [];

    // ✅ Safe iteration
    for await (const [name, handle] of (root as any).entries()) {
      if (handle.kind === "directory") {
        ids.push(name);
      }
    }

    return ids;
  } catch (err) {
    console.error("Failed to list sessions:", err);
    return [];
  }
},
};