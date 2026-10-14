import { Component, useMemo, type ReactNode } from "react";
import { Player } from "@remotion/player";
import type { Format, Lang, Project } from "@gas/shared";
import { AdVideo, calcAdMetadata, getSectionDurations, type AdVideoProps } from "@gas/compositions";
import { useElementSize } from "../hooks/useElementSize";
import { formatSec } from "../util";
import { Icon } from "./ui";

export function PreviewPane(props: { project: Project; format: Format; lang: Lang }) {
  const { project, format, lang } = props;
  const meta = useMemo(() => calcAdMetadata(project, format, lang), [project, format, lang]);
  const inputProps = useMemo<AdVideoProps>(
    () => ({ project, format, lang, assetBaseUrl: "", useProxy: true }),
    [project, format, lang],
  );
  const [stageRef, stage] = useElementSize<HTMLDivElement>();

  // Fit the composition inside the stage, preserving aspect ratio.
  const ar = meta.width / meta.height;
  let w = stage.width;
  let h = w / ar;
  if (h > stage.height) {
    h = stage.height;
    w = h * ar;
  }

  // Hook / end card stretch to fit their narration (docs/ARCHITECTURE.md §5.1).
  const { hookSec, mainSec, endSec, totalSec } = useMemo(
    () => getSectionDurations(project, lang),
    [project, lang],
  );

  return (
    <div className="preview">
      <div className="stage" ref={stageRef}>
        {w > 0 && h > 0 ? (
          <div className="stage-frame" style={{ width: w, height: h }}>
            <PlayerBoundary resetKey={`${project.id}:${format}:${lang}:${meta.durationInFrames}`}>
              <Player
                component={AdVideo}
                inputProps={inputProps}
                durationInFrames={meta.durationInFrames}
                fps={meta.fps}
                compositionWidth={meta.width}
                compositionHeight={meta.height}
                style={{ width: "100%", height: "100%" }}
                controls
                loop
                clickToPlay
                doubleClickToFullscreen
                spaceKeyToPlayOrPause
                acknowledgeRemotionLicense
                errorFallback={({ error }) => <PreviewError message={error.message} />}
              />
            </PlayerBoundary>
          </div>
        ) : null}
      </div>
      <div className="structure" aria-label="構成">
        <div className="structure-bar">
          <span className="st st-hook" style={{ flexGrow: hookSec }}>
            <b>フック</b> {formatSec(hookSec)}
          </span>
          <span className="st st-main" style={{ flexGrow: Math.max(mainSec, 1.5) }}>
            <b>本編</b> {formatSec(mainSec)}
          </span>
          <span className="st st-end" style={{ flexGrow: endSec }}>
            <b>エンド</b> {formatSec(endSec)}
          </span>
        </div>
        <div className="structure-meta mono">
          {meta.width}×{meta.height} · {meta.fps}fps · 計 {formatSec(totalSec)}
          {project.durationSec === null ? <span className="muted">(自由尺)</span> : null}
        </div>
      </div>
    </div>
  );
}

function PreviewError({ message }: { message: string }) {
  return (
    <div className="preview-error">
      <Icon.Alert size={20} />
      <div>プレビューを描画できません</div>
      <div className="mono small muted">{message}</div>
    </div>
  );
}

class PlayerBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }
  render() {
    if (this.state.error) return <PreviewError message={this.state.error.message} />;
    return this.props.children;
  }
}
