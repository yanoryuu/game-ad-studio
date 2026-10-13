import { Icon } from "./ui";

export function ServerDown(props: { onRetry: () => void; detail?: string }) {
  return (
    <div className="server-down" role="alert">
      <div className="server-down-icon">
        <Icon.Plug size={22} />
      </div>
      <div className="server-down-body">
        <div className="server-down-title">サーバーに接続できません</div>
        <p>
          API サーバー(<span className="mono">localhost:3101</span>)が起動していないようです。リポジトリのルートで{" "}
          <code>npm run dev</code> を実行してください。接続できしだい自動で再開します。
        </p>
        {props.detail ? <p className="muted mono small">{props.detail}</p> : null}
      </div>
      <button className="btn" onClick={props.onRetry}>
        再接続
      </button>
    </div>
  );
}
