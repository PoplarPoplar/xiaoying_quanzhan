import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { mergeTask, Task } from "../src/lib/api";
const state = vi.hoisted(() => ({
  user: { id: "user-a", displayName: "A" },
  tasks: {} as Record<string, unknown>,
  merge: vi.fn(),
  api: vi.fn(),
}));
vi.mock("../src/components/shell", () => ({
  useApp: () => state,
  Preview: () => null,
}));
vi.mock("../src/lib/api", async () => ({
  ...(await vi.importActual("../src/lib/api")),
  api: state.api,
}));
import { useTasks } from "../src/components/tasks";
const task = (
  id: string,
  status: Task["status"] = "RUNNING",
  version = 1,
): Task => ({
  id,
  templateId: "one",
  templateTitle: "作品",
  status,
  currentStage: "GENERATE",
  failedStage: null,
  version,
  createdAt: "2026-11-03T00:00:00Z",
  finishedAt: null,
  resultUrl: null,
  error: null,
  steps: [],
});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  state.tasks = {};
});
describe("任务快照合并", () => {
  it("拒绝迟到的受理和历史响应", () => {
    const current = task("a", "SUCCEEDED", 8);
    expect(mergeTask(current, task("a", "RUNNING", 3))).toBe(current);
    expect(mergeTask(current, task("a", "RUNNING", 9))).toBe(current);
  });
  it("不同任务不会互相改写", () => {
    const a = task("a", "SUCCEEDED", 8),
      b = task("b", "FAILED", 4);
    expect(mergeTask(undefined, b).status).toBe("FAILED");
    expect(a.status).toBe("SUCCEEDED");
  });
});
describe("查询生命周期", () => {
  it("A终态停更、B继续、全部完成后停止、卸载清理", async () => {
    vi.useFakeTimers();
    state.api.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/tasks"
          ? { items: [task("a"), task("b")] }
          : path.endsWith("a")
            ? task("a", "SUCCEEDED", 2)
            : task("b", "RUNNING", 2),
      ),
    );
    const hook = renderHook(() => useTasks());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(
      state.api.mock.calls.filter((c) => c[0] === "/tasks/a"),
    ).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(
      state.api.mock.calls.filter((c) => c[0] === "/tasks/a"),
    ).toHaveLength(1);
    expect(
      state.api.mock.calls.filter((c) => c[0] === "/tasks/b"),
    ).toHaveLength(2);
    state.api.mockResolvedValue(task("b", "FAILED", 3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(vi.getTimerCount()).toBe(0);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("查询500保留业务快照，恢复查询只读取GET", async () => {
    vi.useFakeTimers();
    state.tasks = { a: task("a") };
    state.api.mockImplementation((path: string) =>
      path === "/tasks"
        ? Promise.resolve({ items: [task("a")] })
        : Promise.reject(new Error("500")),
    );
    const { result } = renderHook(() => useTasks());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(result.current.errors.a).toBe("500");
    expect(result.current.tasks[0].status).toBe("RUNNING");
    expect(state.merge).toHaveBeenCalledTimes(1);
    act(() => result.current.refresh());
    await flush();
    expect(
      state.api.mock.calls.every(
        (c) => !c[1]?.method || c[1]?.method === "GET",
      ),
    ).toBe(true);
  });
  it("高版本终态缓存拒绝旧RUNNING后也停止轮询", async () => {
    vi.useFakeTimers();
    state.api.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/tasks" ? { items: [task("a")] } : task("a", "RUNNING", 2),
      ),
    );
    const hook = renderHook(() => useTasks());
    await flush();
    state.tasks = { a: task("a", "SUCCEEDED", 8) };
    hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("卸载后忽略迟到历史响应", async () => {
    let resolve!: (v: unknown) => void;
    state.api.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const hook = renderHook(() => useTasks());
    hook.unmount();
    await act(async () => {
      resolve({ items: [task("a")] });
      await Promise.resolve();
    });
    expect(state.merge).not.toHaveBeenCalled();
  });
});
