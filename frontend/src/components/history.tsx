"use client";
import { useTasks, TaskList } from "./tasks";
export function History() {
  const { tasks, error, errors, loading, refresh } = useTasks();
  return (
    <>
      <section className="page-title">
        <div className="eyebrow">YOUR CREATIVE ARCHIVE</div>
        <h1>
          我的作品<span> / {tasks.length}</span>
        </h1>
        <p>每一次创作，都值得被记住。这里是当前身份的全部模板记录。</p>
      </section>
      <div className="section-head">
        <h2>全部制作记录</h2>
        <button onClick={refresh}>刷新记录 ↻</button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button onClick={refresh}>恢复查询</button>
        </div>
      )}
      {loading && <p className="muted">正在同步记录…</p>}
      {!loading && !tasks.length && !error && (
        <p className="empty">还没有作品，去模板中心开启第一份创作吧。</p>
      )}
      <TaskList items={tasks} errors={errors} refresh={refresh} />
    </>
  );
}
