import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ProjectSummary } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { api, errorMessage } from "../api";
import { navigate } from "../hooks/useHashRoute";
import { useHealth } from "../hooks/useHealth";
import { formatRelative } from "../util";
import { Banner, Empty, Icon, Spinner } from "./ui";
import { ServerDown } from "./ServerDown";

const TEMPLATE_LABEL: Record<string, string> = {
  "hook-play-cta": "フック → プレイ → CTA",
  features: "魅力紹介",
  trailer: "トレーラー風",
  intro: "紹介動画風",
};

export function ProjectList() {
  const { status, health, recheck } = useHealth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (status === "ok") void load();
  }, [status, load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    setCreateError(null);
    try {
      const p = await api.createProject({ name: n });
      navigate({ page: "editor", projectId: p.id });
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span />
          </span>
          <span className="brand-name">Game Ad Studio</span>
        </div>
        <div className="home-status">
          {status === "ok" ? (
            <span className="pill pill-ok">
              <span className="dot" /> サーバー接続中
            </span>
          ) : status === "down" ? (
            <span className="pill pill-error">
              <span className="dot" /> サーバー未接続
            </span>
          ) : (
            <span className="pill">
              <Spinner size={10} /> 確認中
            </span>
          )}
        </div>
      </header>

      <main className="home-main">
        <div className="home-hero">
          <h1>
            プレイ動画から、
            <br />
            ウィッシュリスト広告を。
          </h1>
          <p className="muted">素材を登録してクリップを切り出し、テンプレートに流し込んで書き出します。</p>
        </div>

        {status === "down" ? <ServerDown onRetry={recheck} /> : null}

        {health && (!health.ffmpeg || !health.ffprobe) ? (
          <Banner tone="warn">
            ffmpeg / ffprobe が見つかりません(ffmpeg: {health.ffmpeg ? "OK" : "なし"}, ffprobe:{" "}
            {health.ffprobe ? "OK" : "なし"})。素材の登録にはどちらも PATH 上に必要です。
          </Banner>
        ) : null}

        {status === "ok" ? (
          <>
            <form className="create-row" onSubmit={onCreate}>
              <input
                className="input input-lg"
                placeholder="新しいプロジェクト名(例: 星喰いの塔 — 30秒広告)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="プロジェクト名"
              />
              <button className="btn btn-primary btn-lg" type="submit" disabled={!name.trim() || creating}>
                {creating ? <Spinner /> : <Icon.Plus />} 作成
              </button>
            </form>
            {createError ? <Banner tone="error">作成に失敗しました: {createError}</Banner> : null}

            <div className="list-head">
              <h2>プロジェクト</h2>
              {projects ? <span className="muted mono">{projects.length}</span> : null}
            </div>

            {error ? (
              <Banner
                tone="error"
                action={
                  <button className="btn btn-sm" onClick={() => void load()}>
                    再読み込み
                  </button>
                }
              >
                一覧を取得できませんでした: {error}
              </Banner>
            ) : projects === null ? (
              <div className="center-pad">
                <Spinner size={20} />
              </div>
            ) : projects.length === 0 ? (
              <Empty icon={<Icon.Film size={28} />} title="まだプロジェクトがありません">
                上の欄に名前を入れて最初のプロジェクトを作成してください。
              </Empty>
            ) : (
              <ul className="project-grid">
                {projects.map((p) => (
                  <li key={p.id}>
                    <a className="project-card" href={`#/p/${p.id}`}>
                      <div className="project-thumb">
                        {p.thumbPath ? (
                          <img src={assetUrl("", p.id, p.thumbPath)} alt="" loading="lazy" />
                        ) : (
                          <Icon.Film size={28} />
                        )}
                      </div>
                      <div className="project-meta">
                        <div className="project-name">{p.name}</div>
                        <div className="project-sub">
                          <span>{TEMPLATE_LABEL[p.template] ?? p.template}</span>
                          <span className="sep">·</span>
                          <span>{formatRelative(p.updatedAt)}</span>
                        </div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
