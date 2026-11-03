"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import Link from "next/link";
import { api, User, Task, mergeTask } from "../lib/api";
type Context = {
  user: User | null;
  tasks: Record<string, Task>;
  merge: (items: Task[]) => void;
  renew: () => void;
};
const AppContext = createContext<Context>(null!);
export const useApp = () => useContext(AppContext);
export function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [tasks, setTasks] = useState<Record<string, Task>>({}),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [account, setAccount] = useState(false);
  const merge = useCallback(
    (items: Task[]) =>
      setTasks((previous) => {
        const next = { ...previous };
        for (const item of items)
          next[item.id] = mergeTask(next[item.id], item);
        return next;
      }),
    [],
  );
  const renew = useCallback(() => {
    setUser(null);
    setTasks({});
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<User>("/session", { method: "POST", signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setUser(value);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    let alive = true;
    let active: AbortController | null = null;
    window.addEventListener("identity-expired", renew);
    const visibility = () => {
      if (document.visibilityState !== "visible") return;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      api<User>("/me", { signal: controller.signal })
        .then((value) => {
          if (!alive || controller.signal.aborted) return;
          if (user && user.id !== value.id) {
            setTasks({});
            setUser(value);
          }
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      active?.abort();
      window.removeEventListener("identity-expired", renew);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [renew, user]);
  return (
    <AppContext.Provider value={{ user, tasks, merge, renew }}>
      <header>
        <Link className="brand" href="/templates">
          <span className="brand-mark">✦</span> 小影
          <span className="brand-note">STUDIO</span>
        </Link>
        <nav aria-label="主导航">
          <Link href="/templates">模板中心</Link>
          <Link href="/history">我的作品</Link>
        </nav>
        <button className="account" onClick={() => setAccount(true)}>
          {user?.displayName || "匿名工作室"} <span>↗</span>
        </button>
      </header>
      <main>
        {error ? (
          <div className="notice error" role="alert">
            {error} <button onClick={renew}>重新连接</button>
          </div>
        ) : !user ? (
          <p className="empty">正在连接你的工作室…</p>
        ) : (
          children
        )}
      </main>
      <footer>
        小影 STUDIO <span>本地模拟制作 · 灵感，由此展开</span>
      </footer>
      {account && (
        <Preview title="你的工作室" close={() => setAccount(false)}>
          <p>{user?.displayName}</p>
          <p className="muted">用户编号：{user?.id}</p>
          <p>
            身份通过当前浏览器 Cookie 保存。清除
            Cookie、过期或更换浏览器后，无法找回原记录。
          </p>
          <Link href="/history" onClick={() => setAccount(false)}>
            查看我的作品 →
          </Link>
        </Preview>
      )}
    </AppContext.Provider>
  );
}
export function Preview({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    node?.showModal();
    return () => {
      node?.close();
      queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button aria-label="关闭预览" onClick={close}>
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
