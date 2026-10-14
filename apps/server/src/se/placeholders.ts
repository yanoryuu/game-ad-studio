import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SE_PLACEHOLDER_DIR } from "@gas/shared";

/**
 * Placeholder sound effects, synthesized with ffmpeg (no third-party audio) so the SE slots work out of the
 * box: <se.dir>/_placeholder/{pop,headline,point,info,transition,cta}.wav — 48 kHz mono PCM, peak -1 dBFS.
 * Generated only when missing (ensurePlaceholders at startup / rescan). Regenerate by deleting the files.
 */

type Recipe = { expr: string; dur: number; filter: string };

const RECIPES: Record<string, Recipe> = {
  // short pluck
  pop: {
    expr: "sin(2*PI*(700+1600*exp(-t*45))*t)*exp(-t*30)+0.3*sin(4*PI*(700+1600*exp(-t*45))*t)*exp(-t*50)",
    dur: 0.18,
    filter: "afade=t=out:st=0.14:d=0.04",
  },
  // bright major chord hit ("jaan")
  headline: {
    expr:
      "(sin(2*PI*523.25*t)+sin(2*PI*659.25*t)+sin(2*PI*783.99*t)+0.7*sin(2*PI*1046.5*t)+0.35*sin(2*PI*1567.98*t)" +
      "+0.25*sin(2*PI*2093*t)+0.2*sin(2*PI*1318.5*t))*(1-exp(-t*300))*exp(-t*2.6)+0.6*(random(0)*2-1)*exp(-t*40)",
    dur: 1.1,
    filter: "highpass=f=120,afade=t=out:st=0.9:d=0.2",
  },
  // ding
  point: {
    expr: "(sin(2*PI*1760*t)+0.6*sin(2*PI*2637*t)+0.25*sin(2*PI*3520*t))*(1-exp(-t*500))*exp(-t*5)",
    dur: 0.7,
    filter: "afade=t=out:st=0.55:d=0.15",
  },
  // whoosh + click
  info: {
    expr:
      "(random(0)*2-1)*pow(sin(PI*min(t,0.28)/0.28),2)*lt(t,0.28)*0.8+sin(2*PI*2400*t)*exp(-(t-0.28)*90)*gte(t,0.28)",
    dur: 0.42,
    filter: "highpass=f=500,lowpass=f=5000,afade=t=out:st=0.38:d=0.04",
  },
  // whoosh
  transition: {
    expr: "(random(0)*2-1)*pow(sin(PI*t/0.4),3)",
    dur: 0.4,
    filter: "highpass=f=400,lowpass=f=6000,aecho=0.6:0.4:30:0.25",
  },
  // sparkle
  cta: {
    expr:
      "0.8*sin(2*PI*2093*t)*exp(-t*14)+0.7*sin(2*PI*2637*(t-0.07))*exp(-(t-0.07)*14)*gte(t,0.07)" +
      "+0.6*sin(2*PI*3136*(t-0.14))*exp(-(t-0.14)*14)*gte(t,0.14)+0.6*sin(2*PI*4186*(t-0.21))*exp(-(t-0.21)*12)*gte(t,0.21)" +
      "+0.15*(random(0)*2-1)*exp(-t*6)*gt(sin(2*PI*31*t),0)",
    dur: 0.85,
    filter: "highpass=f=800,aecho=0.8:0.5:60:0.3,afade=t=out:st=0.7:d=0.15",
  },
};

export const PLACEHOLDER_NAMES = Object.keys(RECIPES);

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(err) : reject(new Error(`ffmpeg exit ${code}: ${err.trim().split(/\r?\n/).slice(-3).join(" | ")}`)),
    );
  });
}

async function generateOne(name: string, recipe: Recipe, outFile: string, tmpDir: string): Promise<void> {
  const raw = path.join(tmpDir, `${name}.raw.wav`);
  // float intermediate (no clipping), then peak-normalize to -1 dBFS
  await ffmpeg(["-y", "-f", "lavfi", "-i", `aevalsrc='${recipe.expr}':s=48000:d=${recipe.dur}`, "-af", recipe.filter, "-ac", "1", "-c:a", "pcm_f32le", raw]);
  const stats = await ffmpeg(["-i", raw, "-af", "astats", "-f", "null", "-"]);
  const peaks = [...stats.matchAll(/Peak level dB:\s*(-?[\d.]+|-inf)/g)].map((m) => Number(m[1]));
  const peak = peaks.length ? peaks[peaks.length - 1]! : 0;
  const gain = Number.isFinite(peak) ? -1 - peak : 0;
  const tmpOut = `${outFile}.${process.pid}.tmp.wav`;
  await ffmpeg(["-y", "-i", raw, "-af", `volume=${gain.toFixed(3)}dB`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", tmpOut]);
  await fsp.rename(tmpOut, outFile);
}

let running: Promise<string[]> | null = null;

/**
 * Creates <seDir>/_placeholder/<name>.wav for every missing placeholder. Returns the names generated.
 * Never throws (logs instead); concurrent calls share one run.
 */
export function ensurePlaceholders(seDir: string): Promise<string[]> {
  running ??= (async () => {
    const dir = path.join(seDir, SE_PLACEHOLDER_DIR);
    const missing = PLACEHOLDER_NAMES.filter((n) => !fs.existsSync(path.join(dir, `${n}.wav`)));
    if (missing.length === 0) return [];
    const done: string[] = [];
    let tmpDir: string | null = null;
    try {
      await fsp.mkdir(dir, { recursive: true });
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gas-se-"));
      for (const n of missing) {
        try {
          await generateOne(n, RECIPES[n]!, path.join(dir, `${n}.wav`), tmpDir);
          done.push(n);
        } catch (e) {
          console.warn(`[se] could not generate placeholder ${n}.wav: ${(e as Error).message}`);
        }
      }
      if (done.length) console.log(`[se] generated placeholders in ${dir}: ${done.join(", ")}`);
    } catch (e) {
      console.warn(`[se] could not create ${dir}: ${(e as Error).message}`);
    } finally {
      if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    return done;
  })().finally(() => {
    running = null;
  });
  return running;
}
