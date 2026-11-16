export type OfficePhase = "idle" | "converting" | "loading" | "ready" | "error" | "cancelled";

export interface OfficeState {
  phase: OfficePhase;
  jobId?: string;
  error?: string;
}

export type OfficeEvent =
  | { type: "started"; jobId: string }
  | {
      type: "status";
      state: "queued" | "running" | "done" | "error" | "cancelled";
      error?: string;
    }
  | { type: "cancel" }
  | { type: "loaded" }
  | { type: "failed"; message: string }
  | { type: "retry" };

export const DEFAULT_CONVERT_ERROR = "Konversi gagal";

export function officeReducer(state: OfficeState, event: OfficeEvent): OfficeState {
  switch (event.type) {
    case "started":
      return { phase: "converting", jobId: event.jobId };
    case "status": {
      if (state.phase !== "converting") return state;
      if (event.state === "queued" || event.state === "running") return state;
      if (event.state === "done") return { phase: "loading", jobId: state.jobId };
      if (event.state === "cancelled") return { phase: "cancelled", jobId: state.jobId };
      return {
        phase: "error",
        jobId: state.jobId,
        error: event.error || DEFAULT_CONVERT_ERROR,
      };
    }
    case "cancel":
      return state.phase === "converting" ? { phase: "cancelled", jobId: state.jobId } : state;
    case "loaded":
      return state.phase === "loading" ? { ...state, phase: "ready" } : state;
    case "failed":
      return { phase: "error", jobId: state.jobId, error: event.message };
    case "retry":
      return { phase: "idle" };
  }
}
