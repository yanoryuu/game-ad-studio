import { useRef, useState } from "react";
import { DEFAULT_BGM, type AudioSettings, type Bgm, type Project } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { api, errorMessage } from "../api";
import { useBgmAnalyze } from "../hooks/useBgmAnalysis";
import { AUDIO_EXTS, useFileDrop } from "../hooks/useFileDrop";
import type { MutateOnServer, UpdateProject } from "../hooks/useProject";
import { basename, cx } from "../util";
import { bgmFilesOf, useBgmLibrary, useBgmLibrarySync } from "../hooks/useBgmLibrary";
import { BeatPanel } from "./BeatPanel";
import { BgmLibrary, needsCredit } from "./BgmLibrary";
import { SePanel } from "./SePanel";
import { Icon, Section, Slider, Spinner, Switch } from "./ui";

const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.ogg,.aac,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/aac";
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|aac)$/i;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function AudioPanel(props: {
  project: Project;
  update: UpdateProject;
  mutateOnServer: MutateOnServer;
  serverOk: boolean;
  /** output length (preview language), drawn on the beat strip */
  videoSec: number;
  onOpenStructure?: () => void;
}) {
  const { project, update } = props;
  const analyze = useBgmAnalyze(props.mutateOnServer);
  const audio = project.audio;
  const bgm = audio.bgm;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const bgmLib = useBgmLibrary(true);
  useBgmLibrarySync(project, update, bgmFilesOf(bgmLib.state));
  const libRef = bgm?.library;

  const setAudio = (patch: Partial<AudioSettings>) => update((p) => ({ ...p, audio: { ...p.audio, ...patch } }));
  const setBgm = (patch: Partial<Bgm>) =>
    update((p) => (p.audio.bgm ? { ...p, audio: { ...p.audio, bgm: { ...p.audio.bgm, ...patch } } } : p));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!AUDIO_EXT.test(file.name)) {
      setError("mp3 / wav / m4a / ogg / aac のファイルを選んでください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadAsset(project.id, file);
      setFileName(file.name);
      // Keep the previous mix settings when replacing the track, but never its beat analysis (§6.2).
      update((p) => {
        const prev = p.audio.bgm;
        const bgm: Bgm = prev
          ? { ...DEFAULT_BGM, volume: prev.volume, duckingDb: prev.duckingDb, fadeOutSec: prev.fadeOutSec, loop: prev.loop, path: res.path }
          : { ...DEFAULT_BGM, path: res.path };
        return { ...p, audio: { ...p.audio, bgm } };
      });
      analyze.clearError();
      // The trailer cuts on the beat: detect beats right away.
      if (project.template === "trailer" && props.serverOk) void analyze.start();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const drop = useFileDrop({
    accept: AUDIO_EXTS,
    disabled: busy,
    onFiles: (files) => void upload(files[0]),
    onReject: () => setError("mp3 / wav / m4a / ogg / aac のファイルを選んでください"),
  });

  const removeBgm = () =>
    update((p) => {
      const { bgm: _omit, ...rest } = p.audio;
      return { ...p, audio: rest };
    });

  return (
    <div className="audio-panel">
      <Section title="BGM">
        <div
          className={cx("bgm-drop", bgm && "has-file", drop.over && "is-drag is-drop-over")}
          data-drop-label={bgm ? "ここにドロップして差し替え" : "ここにドロップ"}
          {...drop.dropProps}
        >
          {busy ? (
            <div className="bgm-row">
              <Spinner /> アップロード中…
            </div>
          ) : bgm ? (
            <>
              <div className="bgm-row">
                <span className="bgm-icon">
                  <Icon.Music />
                </span>
                <span className="bgm-name" title={libRef ? `ライブラリ: ${libRef.id}` : bgm.path}>
                  {libRef ? basename(libRef.id) : (fileName ?? basename(bgm.path))}
                </span>
                <button className="btn btn-sm ml-auto" onClick={() => inputRef.current?.click()}>
                  差し替え
                </button>
                <button className="btn btn-sm btn-icon btn-ghost btn-danger" onClick={removeBgm} title="BGM を外す" aria-label="BGM を外す">
                  <Icon.Trash />
                </button>
              </div>
              {libRef ? (
                <div className="bgm-current-credit">
                  {libRef.source ? <span className="bgm-badge">{libRef.source}</span> : null}
                  {libRef.credit ? (
                    <span>
                      クレジット: <b>{libRef.credit}</b>(エンドカードと概要欄の表記に入ります)
                    </span>
                  ) : needsCredit(libRef) ? (
                    <span className="warn">⚠ {libRef.source} の曲はクレジットが必要です。ライブラリの ✎ から設定してください</span>
                  ) : (
                    <span className="muted">クレジット表記なし</span>
                  )}
                </div>
              ) : null}
              <audio className="bgm-audio" controls preload="none" src={assetUrl("", project.id, bgm.path)} />
              <BeatPanel
                project={project}
                bgm={bgm}
                videoSec={props.videoSec}
                starting={analyze.starting}
                error={analyze.error}
                disabled={!props.serverOk}
                onAnalyze={() => void analyze.start()}
              />
            </>
          ) : (
            <button type="button" className="bgm-empty" onClick={() => inputRef.current?.click()}>
              <Icon.Music size={20} />
              <span>BGM を選択またはドロップ</span>
              <span className="field-hint">mp3 / wav / m4a / ogg / aac</span>
            </button>
          )}
        </div>
        {error ? <div className="field-hint warn">{error}</div> : null}
        <input ref={inputRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => void upload(e.target.files?.[0])} />

        {bgm ? (
          <>
            <Slider label="音量" value={bgm.volume} min={0} max={1} step={0.01} format={pct} onChange={(volume) => setBgm({ volume })} />
            <Slider
              label="ナレーション中のダッキング"
              value={bgm.duckingDb}
              min={-30}
              max={0}
              step={1}
              format={(v) => (v === 0 ? "なし" : `${v} dB`)}
              onChange={(duckingDb) => setBgm({ duckingDb })}
              hint="ナレーションが流れている間だけ BGM を下げます"
            />
            <Slider
              label="末尾フェードアウト"
              value={bgm.fadeOutSec}
              min={0}
              max={5}
              step={0.1}
              format={(v) => `${v.toFixed(1)} 秒`}
              onChange={(fadeOutSec) => setBgm({ fadeOutSec })}
            />
            <Switch checked={bgm.loop} onChange={(loop) => setBgm({ loop })} label="ループして動画全体を埋める" />
          </>
        ) : null}
        <BgmLibrary project={project} mutateOnServer={props.mutateOnServer} serverOk={props.serverOk} />
      </Section>

      <Section title="ミックス">
        <Slider
          label="ナレーション音量"
          value={audio.narrationVolume}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(narrationVolume) => setAudio({ narrationVolume })}
        />
        <Slider
          label="ナレーション中のゲーム音"
          value={audio.gameVolumeUnderNarration}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(gameVolumeUnderNarration) => setAudio({ gameVolumeUnderNarration })}
          hint="各クリップのゲーム音に掛ける倍率(ナレーション中のみ)"
        />
      </Section>

      <SePanel project={project} update={update} serverOk={props.serverOk} onOpenStructure={props.onOpenStructure} />
    </div>
  );
}
