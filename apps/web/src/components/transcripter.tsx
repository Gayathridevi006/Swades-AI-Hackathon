"use client";

import { Button } from "@/components/ui/button";
import { useTranscripter } from "@/hooks/use-transcripter";

export function Transcripter() {
  const {
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
  } = useTranscripter({ timesliceMs: 3000 });

  const total = chunks.length;
  const progress = total === 0 ? 0 : Math.round((ackedCount / total) * 100);
  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isBusy =
    status === "stopping" || status === "reconciling" || status === "requesting-mic";

  return (
    <div
      data-testid="transcripter"
      className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-2xl border p-6 shadow-sm"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" data-testid="transcripter-title">
          Transcripter
        </h2>
        <span
          data-testid="transcripter-status"
          className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
        >
          {status}
        </span>
      </header>

      <div
        className="text-xs text-muted-foreground"
        data-testid="transcripter-session"
      >
        session: <span className="font-mono">{sessionId}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {!isRecording && !isPaused && (
          <Button
            data-testid="transcripter-start-btn"
            onClick={start}
            disabled={isBusy}
          >
            Start Recording
          </Button>
        )}

        {isRecording && (
          <Button
            data-testid="transcripter-pause-btn"
            variant="secondary"
            onClick={pause}
          >
            Pause
          </Button>
        )}

        {isPaused && (
          <Button data-testid="transcripter-resume-btn" onClick={resume}>
            Resume
          </Button>
        )}

        {(isRecording || isPaused) && (
          <Button
            data-testid="transcripter-stop-btn"
            variant="destructive"
            onClick={stop}
            disabled={isBusy}
          >
            Stop
          </Button>
        )}

        <Button
          data-testid="transcripter-reset-btn"
          variant="outline"
          onClick={reset}
          disabled={isRecording || isPaused || isBusy}
        >
          Reset
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs">
          <span data-testid="transcripter-acked-count">
            acked: {ackedCount}/{total}
          </span>
          <span data-testid="transcripter-inflight-count">
            in-flight: {uploadsInFlight}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
          data-testid="transcripter-progress"
        >
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {error && (
        <div
          data-testid="transcripter-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <ul
        data-testid="transcripter-chunk-list"
        className="max-h-52 overflow-auto rounded-md border text-xs"
      >
        {chunks.length === 0 && (
          <li className="p-2 text-muted-foreground">No chunks yet.</li>
        )}
        {chunks.map((c) => (
          <li
            key={c.chunkId}
            data-testid={`transcripter-chunk-${c.index}`}
            className="flex items-center justify-between border-b p-2 last:border-b-0"
          >
            <span className="font-mono">{c.chunkId}</span>
            <span>
              {(c.size / 1024).toFixed(1)} KB ·{" "}
              {c.acked ? (
                <span className="text-green-600">acked</span>
              ) : (
                <span className="text-amber-600">pending</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Transcripter;