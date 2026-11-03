export type User = { id: string; displayName: string };
export type Template = {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  coverUrl: string;
  requiredImageCount: number;
  acceptedMimeTypes: string[];
  maxFileSizeBytes: number;
};
export type Stage = "CHECK_ASSETS" | "GENERATE" | "PACKAGE_RESULT";
export type Task = {
  id: string;
  templateId: string;
  templateTitle: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  currentStage: Stage | null;
  failedStage: Stage | null;
  version: number;
  createdAt: string;
  finishedAt: string | null;
  resultUrl: string | null;
  error: { code: string; message: string } | null;
  steps: { stage: Stage; status: string }[];
};
export const stages: Record<Stage, string> = {
  CHECK_ASSETS: "素材检查",
  GENERATE: "模拟生成",
  PACKAGE_RESULT: "结果整理",
};
export const terminal = (task: Task) =>
  task.status === "SUCCEEDED" || task.status === "FAILED";
export function mergeTask(old: Task | undefined, next: Task): Task {
  if (!old) return next;
  if (next.version < old.version || (terminal(old) && !terminal(next)))
    return old;
  return next;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    const response = await fetch("/api" + path, {
      ...init,
      signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      let message = "请求失败，请稍后重试";
      try {
        message = (await response.json()).message || message;
      } catch {}
      if (response.status === 401)
        window.dispatchEvent(new Event("identity-expired"));
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
