"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { opfs, type ChunkMeta } from "@/lib/opfs";
import { uploader, type UploadResult } from "@/lib/chunk-uploader";

export type TranscripterStatus =
  | "idle"
  | "requesting-mic"
  | "recording"
  | "paused"
  | "stopping"
  | "reconciling"
  | "error";

export type TranscripterOptions = {
  /** Chunk length in ms. Default: 3000 (3s). */
  timesliceMs?: number;
  /** Preferred mime type. Default: audio/webm;codecs=opus. */
  mimeType?: string;
  /** Provide your own session id to resume an existing OPFS session. */
  sessionId?: string;
};

function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess-${ts}-${rand}`;
}

function pickMimeType(preferred?: string): string {
  const candidates = [
    preferred,
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "audio/webm";
}

export function useTranscripter(opts: TranscripterOptions = {}) {
  const timesliceMs = opts.timesliceMs ?? 3000;

  const [sessionId, setSessionId] = useState<string>(() => opts.sessionId ?? newSessionId());
  const [status, setStatus] = useState<TranscripterStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ChunkMeta[]>([]);
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const [ackedCount, setAckedCount] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const indexRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const refreshChunks = useCallback(async (sid: string) => {
    const all = await opfs.listChunks(sid);
    setChunks(all);
    setAckedCount(all.filter((c) => c.acked).length);
  }, []);

  // On mount: flush pending + reconcile for the current session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("reconciling");
        await uploader.flushPending(sessionId);
        try {
          await uploader.reconcile(sessionId);
        } catch {
          /* reconcile is best-effort at mount */
        }
        if (!cancelled) {
          await refreshChunks(sessionId);
          setStatus("idle");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshChunks]);

  const handleDataAvailable = useCallback(
    (ev: BlobEvent) => {
      if (!ev.data || ev.data.size === 0) return;
      const idx = indexRef.current;
      indexRef.current += 1;
      const blob = ev.data;
      const sid = sessionId;

      // Serialize OPFS writes + uploads per-session to keep ordering stable.
      queueRef.current = queueRef.current.then(async () => {
        try {
          const meta = await opfs.writeChunk(sid, idx, blob);
          setChunks((prev) => [...prev, meta]);
          setUploadsInFlight((n) => n + 1);
          const r: UploadResult = await uploader.uploadChunk(meta);
          setUploadsInFlight((n) => Math.max(0, n - 1));
          if (r.ok) {
            setAckedCount((n) => n + 1);
            setChunks((prev) =>
              prev.map((c) => (c.chunkId === meta.chunkId ? { ...c, acked: true } : c)),
            );
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    },
    [sessionId],
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      setStatus("requesting-mic");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType(opts.mimeType);
      const rec = new MediaRecorder(stream, { mimeType });
      rec.ondataavailable = handleDataAvailable;
      rec.onerror = (e) => {
        setError((e as unknown as { error?: Error }).error?.message ?? "recorder error");
        setStatus("error");
      };
      recorderRef.current = rec;
      rec.start(timesliceMs);
      setStatus("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [handleDataAvailable, opts.mimeType, timesliceMs]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      setStatus("paused");
    }
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      setStatus("recording");
    }
  }, []);

  const stop = useCallback(async () => {
    setStatus("stopping");
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;

    // Wait for the in-memory queue to drain.
    await queueRef.current;

    setStatus("reconciling");
    try {
      await uploader.flushPending(sessionId);
      await uploader.reconcile(sessionId);
      await refreshChunks(sessionId);
      // Free OPFS only if everything is in sync.
      await uploader.finalize(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
  }, [sessionId, refreshChunks]);

  const reset = useCallback(async () => {
    await opfs.clearSession(sessionId);
    indexRef.current = 0;
    setChunks([]);
    setAckedCount(0);
    setSessionId(newSessionId());
  }, [sessionId]);

  return {
    sessionId,
    status,
    error,
    chunks,
    uploadsInFlight,
    ackedCount,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}