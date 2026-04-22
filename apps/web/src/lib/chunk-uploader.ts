// ❌ REMOVE static import of opfs
// import { opfs, type ChunkMeta } from "./opfs.client";

// ✅ Keep type locally (or you can re-export it separately)
export type ChunkMeta = {
  sessionId: string;
  chunkId: string;
  index: number;
  size: number;
  mimeType: string;
  createdAt: number;
  acked: boolean;
};

// ✅ Dynamic import (CRITICAL)
async function getOpfs() {
  return await import("./opfs.client");
}

const API_BASE =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

export type UploadResult =
  | { ok: true; chunkId: string }
  | { ok: false; chunkId: string; error: string };

async function uploadOnce(meta: ChunkMeta, blob: Blob): Promise<UploadResult> {
  const form = new FormData();
  form.append("sessionId", meta.sessionId);
  form.append("chunkId", meta.chunkId);
  form.append("index", String(meta.index));
  form.append("mimeType", meta.mimeType);
  form.append("file", blob, `${meta.chunkId}.bin`);

  const res = await fetch(`${API_BASE}/api/chunks/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    return { ok: false, chunkId: meta.chunkId, error: `HTTP ${res.status}` };
  }

  const body = (await res.json()) as { ack: boolean };

  if (!body.ack) {
    return { ok: false, chunkId: meta.chunkId, error: "server did not ack" };
  }

  return { ok: true, chunkId: meta.chunkId };
}

async function uploadWithRetry(
  meta: ChunkMeta,
  blob: Blob,
  maxAttempts = 6,
): Promise<UploadResult> {
  let attempt = 0;
  let lastErr = "unknown";

  while (attempt < maxAttempts) {
    try {
      const r = await uploadOnce(meta, blob);
      if (r.ok) return r;
      lastErr = r.error;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }

    attempt += 1;

    const delay =
      Math.min(8000, 250 * 2 ** (attempt - 1)) + Math.random() * 200;

    await new Promise((r) => setTimeout(r, delay));
  }

  return { ok: false, chunkId: meta.chunkId, error: lastErr };
}

export const uploader = {
  async uploadChunk(meta: ChunkMeta): Promise<UploadResult> {
    const { opfs } = await getOpfs(); // ✅ FIX

    const blob = await opfs.readChunk(meta.sessionId, meta.chunkId);
    const result = await uploadWithRetry(meta, blob);

    if (result.ok) {
      await opfs.markAcked(meta.sessionId, meta.chunkId);
    }

    return result;
  },

  async flushPending(sessionId: string): Promise<UploadResult[]> {
    const { opfs } = await getOpfs(); // ✅ FIX

    const pending = await opfs.listPending(sessionId);
    const results: UploadResult[] = [];

    for (const meta of pending) {
      results.push(await uploader.uploadChunk(meta));
    }

    return results;
  },

  async reconcile(sessionId: string): Promise<UploadResult[]> {
    const { opfs } = await getOpfs(); // ✅ FIX

    const res = await fetch(
      `${API_BASE}/api/chunks/session/${encodeURIComponent(sessionId)}/status`,
    );

    if (!res.ok) {
      throw new Error(`reconcile failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      present: string[];
      acked: string[];
    };

    const present = new Set(body.present);
    const acked = new Set(body.acked);

    const local = await opfs.listChunks(sessionId);

    const missing = local.filter(
      (c) =>
        (acked.has(c.chunkId) || c.acked) &&
        !present.has(c.chunkId),
    );

    const results: UploadResult[] = [];

    for (const meta of missing) {
      const blob = await opfs.readChunk(meta.sessionId, meta.chunkId);
      const r = await uploadWithRetry(meta, blob);

      if (r.ok) {
        await opfs.markAcked(meta.sessionId, meta.chunkId);
      }

      results.push(r);
    }

    return results;
  },

  async finalize(sessionId: string): Promise<void> {
    const { opfs } = await getOpfs(); // ✅ FIX

    const pending = await opfs.listPending(sessionId);

    if (pending.length === 0) {
      await opfs.clearSession(sessionId);
    }
  },
};