import type React from "react";
import { Audio, Sequence, interpolate, useVideoConfig } from "remotion";
import type { Project } from "@gas/shared";
import type { NarrationPlan } from "./narrationLayout";
import { assetUrl } from "./urls";

/** Short fade at the end of a line that was cut at its section end. */
const CUT_FADE_SEC = 0.12;

/** Narration voice tracks (one <Audio> per placed line) at audio.narrationVolume. */
export const Narration: React.FC<{ project: Project; plan: NarrationPlan; assetBaseUrl: string }> = ({
  project,
  plan,
  assetBaseUrl,
}) => {
  const { fps } = useVideoConfig();
  const volume = project.audio.narrationVolume;
  if (volume <= 0) return null;
  const byId = new Map(project.script.map((l) => [l.id, l]));
  return (
    <>
      {plan.lines.map((p) => {
        const line = byId.get(p.lineId);
        if (!line?.audioPath || p.durationInFrames <= 0) return null;
        const dur = p.durationInFrames;
        const fade = p.cut ? Math.min(Math.max(1, Math.round(CUT_FADE_SEC * fps)), dur) : 0;
        return (
          <Sequence key={p.lineId} from={p.from} durationInFrames={dur} name={`narration ${p.lineId}`} layout="none">
            <Audio
              src={assetUrl(assetBaseUrl, project.id, line.audioPath)}
              volume={(f) =>
                fade > 0
                  ? volume * interpolate(f, [dur - fade, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
                  : volume
              }
            />
          </Sequence>
        );
      })}
    </>
  );
};
