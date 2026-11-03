"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Task, terminal, stages, mergeTask } from "../lib/api";
import { useApp, Preview } from "./shell";
export function useTasks() {
  const { user, tasks, merge } = useApp();
  const [error, setError] = useState(""),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const latest = useRef(tasks);
  latest.current = tasks;
  const refresh = useCallback(() => setRevision((x) => x + 1), []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const controller = new AbortController();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    setLoading(true);
    setError("");
    setErrors({});
    const poll = (id: string) => {
      api<Task>("/tasks/" + encodeURIComponent(id), {
        signal: controller.signal,
      })
        .then((item) => {
          if (!alive) return;
          const accepted = mergeTask(latest.current[id], item);
          latest.current = { ...latest.current, [id]: accepted };
          merge([item]);
          setErrors((old) => {
            const next = { ...old };
            delete next[id];
            return next;
          });
          if (!terminal(accepted))
            timers.set(
              id,
              setTimeout(() => poll(id), 1200),
            );
        })
        .catch((e) => {
          if (alive && !controller.signal.aborted)
            setErrors((old) => ({ ...old, [id]: e.message }));
        });
    };
    api<{ items: Task[] }>("/tasks", { signal: controller.signal })
      .then((value) => {
        if (!alive) return;
        merge(value.items);
        for (const task of value.items) {
          const current = latest.current[task.id];
          if (
            !terminal(
              current && current.version > task.version ? current : task,
            )
          )
            timers.set(
              task.id,
              setTimeout(() => poll(task.id), 1200),
            );
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
      timers.forEach(clearTimeout);
    };
  }, [user, revision, merge]);
  return {
    tasks: Object.values(tasks).sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    ),
    error,
    errors,
    loading,
    refresh,
  };
}
export function TaskList({
  items,
  errors,
  refresh,
}: {
  items: Task[];
  errors: Record<string, string>;
  refresh: () => void;
}) {
  const [preview, setPreview] = useState<Task | null>(null);
  return (
    <>
      <div className="task-grid">
        {items.map((task) => (
          <article
            className={"task-card " + task.status.toLowerCase()}
            key={task.id}
          >
            <div className="task-top">
              <span className="status">
                {
                  {
                    QUEUED: "等待制作",
                    RUNNING: "制作中",
                    SUCCEEDED: "制作完成",
                    FAILED: "制作失败",
                  }[task.status]
                }
              </span>
              <small>#{task.id.slice(0, 8)}</small>
            </div>
            {task.status === "SUCCEEDED" && task.resultUrl ? (
              <button
                className="result"
                onClick={() => setPreview(task)}
                aria-label={"预览" + task.templateTitle}
              >
                <img
                  src={task.resultUrl}
                  alt={task.templateTitle + "制作结果"}
                />
                <span>放大预览 ↗</span>
              </button>
            ) : (
              <div className="task-visual">
                <span>
                  {task.status === "FAILED"
                    ? "!"
                    : task.status === "RUNNING"
                      ? "✳"
                      : "◷"}
                </span>
                <p>
                  {task.currentStage
                    ? stages[task.currentStage]
                    : "等待后台处理"}
                </p>
              </div>
            )}
            <h3>{task.templateTitle}</h3>
            <ol className="steps">
              {task.steps.map((step) => (
                <li key={step.stage} data-status={step.status}>
                  <span>
                    {step.status === "SUCCEEDED"
                      ? "✓"
                      : step.status === "FAILED"
                        ? "!"
                        : "·"}
                  </span>
                  {stages[step.stage]}
                </li>
              ))}
            </ol>
            {task.error && (
              <p className="error">
                {task.failedStage ? stages[task.failedStage] + "：" : ""}
                {task.error.message}
              </p>
            )}
            <time dateTime={task.createdAt}>
              {new Date(task.createdAt).toLocaleString("zh-CN")}
            </time>
            {task.finishedAt && (
              <p className="muted">
                完成于 {new Date(task.finishedAt).toLocaleTimeString("zh-CN")}
              </p>
            )}
            {errors[task.id] && (
              <div className="notice error" role="alert">
                查询中断：{errors[task.id]}。保留最后状态。
                <button onClick={refresh}>恢复查询</button>
              </div>
            )}
          </article>
        ))}
      </div>
      {preview && (
        <Preview title={preview.templateTitle} close={() => setPreview(null)}>
          <img
            className="preview-image"
            src={preview.resultUrl!}
            alt="完整制作结果"
          />
          <p className="muted">本地预置演示结果，非真实 AI 生成。</p>
        </Preview>
      )}
    </>
  );
}
