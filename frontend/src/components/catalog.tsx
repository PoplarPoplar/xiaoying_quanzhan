"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Template } from "../lib/api";
export function Catalog() {
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [category, setCategory] = useState(""),
    [templates, setTemplates] = useState<Template[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ id: string; name: string }[]>("/categories", {
      signal: controller.signal,
    })
      .then(setCategories)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Template[]>(
      "/templates" +
        (category ? "?categoryId=" + encodeURIComponent(category) : ""),
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setTemplates(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [category, retry]);
  return (
    <>
      <section className="hero">
        <div className="eyebrow">THE CREATIVE COLLECTION / 01</div>
        <h1>
          让灵感，<span>有迹可循。</span>
        </h1>
        <p>选择一份模板，上传你的瞬间。把平凡日常，制作成值得收藏的作品。</p>
        <span className="hero-star">✳</span>
      </section>
      <div className="section-head">
        <div>
          <h2>
            探索模板 <span className="count">精选素材</span>
          </h2>
          <p className="muted">由你的图片开启，一次轻量的创作实验</p>
        </div>
      </div>
      <div className="filters" aria-label="模板分类">
        <button
          className={!category ? "active" : ""}
          onClick={() => setCategory("")}
        >
          全部模板
        </button>
        {categories.map((item) => (
          <button
            key={item.id}
            className={category === item.id ? "active" : ""}
            onClick={() => setCategory(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {error ? (
        <div className="notice error" role="alert">
          {error}
          <button onClick={() => setRetry(retry + 1)}>重试加载</button>
        </div>
      ) : loading ? (
        <p className="empty">正在整理灵感…</p>
      ) : templates.length === 0 ? (
        <p className="empty">这个分类还没有模板，试试其他分类。</p>
      ) : (
        <div className="template-grid">
          {templates.map((item, index) => (
            <Link
              className="template-card"
              href={"/templates/" + item.id}
              key={item.id}
            >
              <div className="cover">
                <img src={item.coverUrl} alt={item.title} />
                <span className="number">0{index + 1}</span>
                <span className="cover-action">开始创作 ↗</span>
              </div>
              <div className="card-caption">
                <h3>{item.title}</h3>
                <span>{item.requiredImageCount} 张图片 ↗</span>
              </div>
              <p>{item.description}</p>
            </Link>
          ))}
        </div>
      )}
      <aside className="collection-note">
        <span>✧</span>
        <div>
          <strong>每一个瞬间，都有另一种表达。</strong>
          <p>
            上传与任务记录真实保存。制作结果为本地预置演示图片，不调用真实 AI。
          </p>
        </div>
      </aside>
    </>
  );
}
