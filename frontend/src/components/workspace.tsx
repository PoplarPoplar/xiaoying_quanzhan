"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, Task, Template, Stage, stages } from "../lib/api";
import { useApp } from "./shell";
import { useTasks, TaskList } from "./tasks";
type Slot = {
  status: "EMPTY" | "UPLOADING" | "READY" | "ERROR";
  id?: string;
  preview?: string;
  error?: string;
  file?: File;
};
export function Upload({
  index,
  template,
  onChange,
}: {
  index: number;
  template: Template;
  onChange: (slot: Slot) => void;
}) {
  const [slot, setSlot] = useState<Slot>({ status: "EMPTY" });
  const active = useRef<AbortController | null>(null),
    generation = useRef(0),
    url = useRef("");
  useEffect(
    () => () => {
      generation.current++;
      active.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  const update = (value: Slot) => {
    setSlot(value);
    onChange(value);
  };
  const remove = () => {
    generation.current++;
    active.current?.abort();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
    update({ status: "EMPTY" });
  };
  const upload = async (file: File) => {
    const current = ++generation.current;
    active.current?.abort();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
    if (!template.acceptedMimeTypes.includes(file.type)) {
      update({ status: "ERROR", error: "仅支持 JPEG / PNG 图片" });
      return;
    }
    if (file.size > template.maxFileSizeBytes || file.size === 0) {
      update({ status: "ERROR", error: "图片为空或超过大小限制" });
      return;
    }
    url.current = URL.createObjectURL(file);
    const preview = url.current;
    update({ status: "UPLOADING", preview, file });
    const controller = new AbortController();
    active.current = controller;
    const data = new FormData();
    data.append("file", file);
    data.append("templateId", template.id);
    try {
      const result = await api<{ id: string }>("/assets", {
        method: "POST",
        body: data,
        signal: controller.signal,
      });
      if (current === generation.current)
        update({ status: "READY", id: result.id, preview, file });
    } catch (e) {
      if (current === generation.current && !controller.signal.aborted)
        update({ status: "ERROR", preview, file, error: (e as Error).message });
    }
  };
  return (
    <div className="upload-slot">
      {slot.preview && (
        <img src={slot.preview} alt={"素材" + (index + 1) + "预览"} />
      )}
      <label>
        <span>
          {slot.status === "EMPTY"
            ? "＋"
            : slot.status === "UPLOADING"
              ? "上传中…"
              : "替换图片"}
        </span>
        <small>素材 {index + 1}</small>
        <input
          aria-label={"选择素材" + (index + 1)}
          type="file"
          accept={template.acceptedMimeTypes.join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>
      {slot.status === "READY" && <p className="ready">✓ 上传完成</p>}
      {slot.error && (
        <p className="error" role="alert">
          {slot.error}
        </p>
      )}
      <div className="slot-actions">
        {slot.file && slot.status === "ERROR" && (
          <button onClick={() => void upload(slot.file!)}>重试上传</button>
        )}
        {slot.status !== "EMPTY" && (
          <button onClick={remove}>移除素材{index + 1}</button>
        )}
      </div>
    </div>
  );
}
export function Workspace({ id }: { id: string }) {
  const { user } = useApp();
  return <WorkspaceContent key={(user?.id || "") + id} id={id} />;
}
function WorkspaceContent({ id }: { id: string }) {
  const { user, merge } = useApp();
  const { tasks, error, errors, loading, refresh } = useTasks();
  const [template, setTemplate] = useState<Template | null>(null),
    [templateError, setTemplateError] = useState(""),
    [reload, setReload] = useState(0),
    [slots, setSlots] = useState<Record<number, Slot>>({}),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [failAt, setFailAt] = useState("NONE"),
    [delay, setDelay] = useState(2000),
    [demo, setDemo] = useState(false);
  const submitting = useRef(false),
    submitController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<Template>("/templates/" + encodeURIComponent(id), {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setTemplate(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setTemplateError(e.message);
      });
    return () => controller.abort();
  }, [id, reload]);
  useEffect(() => () => submitController.current?.abort(), [user?.id, id]);
  const submit = async () => {
    if (!template || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setMessage("");
    const controller = new AbortController();
    submitController.current = controller;
    try {
      const task = await api<Task>("/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: template.id,
          assetIds: Array.from(
            { length: template.requiredImageCount },
            (_, i) => slots[i]?.id,
          ),
          ...(demo
            ? {
                simulation: {
                  failAt,
                  delaysMs: {
                    CHECK_ASSETS: delay,
                    GENERATE: delay,
                    PACKAGE_RESULT: delay,
                  },
                },
              }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        merge([task]);
        refresh();
        setMessage("已受理，素材已保留，你可以继续创建下一份作品。");
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setMessage(
          "提交未确认：" +
            (e as Error).message +
            "。请求可能已受理，请先刷新记录核对，避免重复创建。",
        );
    } finally {
      submitting.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  };
  if (templateError)
    return (
      <div className="notice error" role="alert">
        {templateError}
        <button
          onClick={() => {
            setTemplateError("");
            setReload(reload + 1);
          }}
        >
          重试
        </button>
        <Link href="/templates">返回模板中心</Link>
      </div>
    );
  if (!template) return <p className="empty">正在打开制作台…</p>;
  const valid = Array.from(
    { length: template.requiredImageCount },
    (_, i) => slots[i]?.status === "READY",
  ).every(Boolean);
  return (
    <>
      <Link className="back" href="/templates">
        ← 返回模板中心
      </Link>
      <div className="workspace">
        <section className="maker">
          <div className="eyebrow">CREATE SOMETHING PERSONAL</div>
          <h1>{template.title}</h1>
          <img
            className="maker-cover"
            src={template.coverUrl}
            alt={template.title + "示例"}
          />
          <p>{template.description}</p>
          <h2>
            上传你的素材{" "}
            <span className="count">{template.requiredImageCount} 张</span>
          </h2>
          <p className="muted">
            JPEG / PNG，每张不超过{" "}
            {Math.round(template.maxFileSizeBytes / 1024 / 1024)} MB
          </p>
          <div className="uploads">
            {Array.from({ length: template.requiredImageCount }, (_, index) => (
              <Upload
                key={user?.id + id + index}
                index={index}
                template={template}
                onChange={(slot) =>
                  setSlots((old) => ({ ...old, [index]: slot }))
                }
              />
            ))}
          </div>
          <details>
            <summary>演示控制</summary>
            <label className="inline">
              <input
                type="checkbox"
                checked={demo}
                onChange={(e) => setDemo(e.target.checked)}
              />{" "}
              使用自定义模拟配置（仅 demo/test）
            </label>
            {demo && (
              <>
                <label className="field">
                  失败阶段
                  <select
                    value={failAt}
                    onChange={(e) => setFailAt(e.target.value)}
                  >
                    <option value="NONE">全部成功</option>
                    {Object.entries(stages).map(([key, label]) => (
                      <option value={key} key={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  每阶段耗时（毫秒）
                  <input
                    type="number"
                    min="0"
                    max="30000"
                    value={delay}
                    onChange={(e) =>
                      setDelay(
                        Math.max(0, Math.min(30000, Number(e.target.value))),
                      )
                    }
                  />
                </label>
                <p className="muted">
                  任务失败后停止后续阶段；正式配置不接受模拟参数。
                </p>
              </>
            )}
          </details>
          <button
            className="primary"
            disabled={!valid || pending}
            onClick={() => void submit()}
          >
            {pending ? "正在提交…" : "开始制作"} <span>↗</span>
          </button>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          <p className="disclaimer">
            ✧ 结果使用本地预置演示图，不代表真实 AI 处理。
          </p>
        </section>
        <section className="records">
          <div className="section-head">
            <div>
              <h2>制作记录</h2>
              <p className="muted">当前模板 · 独立跟踪每一次创作</p>
            </div>
            <button onClick={refresh}>刷新记录 ↻</button>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button onClick={refresh}>恢复查询</button>
            </div>
          )}
          {loading && <p className="muted">正在同步记录…</p>}
          {!loading &&
            !tasks.some((task) => task.templateId === id) &&
            !error && (
              <div className="empty">
                <span className="empty-icon">✧</span>
                <h3>第一份灵感，等待开始</h3>
                <p>完成左侧上传，作品会在这里持续更新。</p>
              </div>
            )}
          <TaskList
            items={tasks.filter((task) => task.templateId === id)}
            errors={errors}
            refresh={refresh}
          />
          <Link className="all-history" href="/history">
            查看全部模板的作品 →
          </Link>
        </section>
      </div>
    </>
  );
}
