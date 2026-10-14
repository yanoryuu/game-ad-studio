import { useEffect, useRef, useState, type DragEvent } from "react";
import { IMAGE_EXTS, SE_EXTS, VIDEO_EXTS } from "@gas/shared";

/**
 * File drag & drop for drop zones (sources, logo / key art, BGM, recordings, SE library) plus the
 * window-level handling (whole-editor overlay, never navigating to a dropped file).
 *
 * A zone marks the native events it handled (handledByZone) so window listeners can tell
 * "dropped on a zone" from "dropped anywhere else" regardless of listener order.
 */

export const AUDIO_EXTS = SE_EXTS; // .wav .mp3 .ogg .m4a .aac (same set as asset uploads)
export const LOGO_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"] as const;
export const SOURCE_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS] as const;

/** `accept` attribute for a file input: ".mp4,.mov,…" */
export const acceptAttr = (exts: readonly string[]) => exts.join(",");

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export const hasExt = (exts: readonly string[], name: string) => exts.includes(extOf(name));

export type DroppedKind = "video" | "image" | "audio" | "other";
export function droppedKind(name: string): DroppedKind {
  if (hasExt(VIDEO_EXTS, name)) return "video";
  if (hasExt(IMAGE_EXTS, name)) return "image";
  if (hasExt(AUDIO_EXTS, name)) return "audio";
  return "other";
}

const handled = new WeakSet<Event>();
/** true if a drop zone already handled this native drag event. */
export const handledByZone = (e: Event) => handled.has(e);

/** Only file drags (not text / links dragged inside the page). */
export const isFileDrag = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes("Files");

export type FileDropOptions = {
  /** accepted extensions (with dot, lowercase) */
  accept: readonly string[];
  /** accepted files (only the first one unless `multiple`) */
  onFiles: (files: File[]) => void;
  /** files with other extensions (e.g. show "mp3 / wav … を選んでください") */
  onReject?: (files: File[]) => void;
  multiple?: boolean;
  /** still swallows drops (so they don't fall through to the editor overlay) but ignores them */
  disabled?: boolean;
};

/**
 * Drop zone: spread `dropProps` on the element; `over` is true while files are dragged over it
 * (dragenter/leave counter, so child elements don't flicker the highlight).
 */
export function useFileDrop(opts: FileDropOptions) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // A drag that ends elsewhere (Esc, drop on another zone, element re-render) must not leave the highlight on.
  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setOver(false);
    };
    window.addEventListener("drop", reset);
    window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("drop", reset);
      window.removeEventListener("dragend", reset);
    };
  }, []);

  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      handled.add(e.nativeEvent);
      e.preventDefault();
      depth.current += 1;
      if (!optsRef.current.disabled) setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      handled.add(e.nativeEvent);
      e.preventDefault();
      e.dataTransfer.dropEffect = optsRef.current.disabled ? "none" : "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      handled.add(e.nativeEvent);
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      handled.add(e.nativeEvent);
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const o = optsRef.current;
      if (o.disabled) return;
      const files = Array.from(e.dataTransfer.files);
      const ok = files.filter((f) => hasExt(o.accept, f.name));
      const bad = files.filter((f) => !hasExt(o.accept, f.name));
      if (ok.length) o.onFiles(o.multiple ? ok : ok.slice(0, 1));
      if (bad.length && (!ok.length || o.multiple)) o.onReject?.(bad);
    },
  };

  return { over, dropProps };
}

/**
 * Whole-window drop target (editor overlay): `dragging` while files are dragged over the window,
 * `inZone` while the pointer is over a drop zone (the overlay then steps back and the zone highlights).
 * `onDrop` gets the files dropped outside every zone. Disabled -> no overlay, drops ignored.
 */
export function useWindowFileDrop(onDrop: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const [inZone, setInZone] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const enter = (e: globalThis.DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (e: globalThis.DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: globalThis.DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      const zone = handledByZone(e);
      setInZone(zone);
      e.preventDefault();
      if (!zone && e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const end = () => {
      depth = 0;
      setDragging(false);
      setInZone(false);
    };
    const drop = (e: globalThis.DragEvent) => {
      end();
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (handledByZone(e)) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onDropRef.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", end);
      end();
    };
  }, [enabled]);

  return { dragging: enabled && dragging, inZone };
}

/**
 * Window level: the browser must never navigate to (open) a file dropped outside a zone.
 * Install once (main.tsx). Zones and the editor overlay decide what a drop does.
 */
export function preventFileNavigation(): void {
  const block = (e: globalThis.DragEvent) => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    // outside a zone: "no drop" cursor unless the editor overlay accepts it (its listener runs later)
    if (e.type === "dragover" && !handledByZone(e) && e.dataTransfer) e.dataTransfer.dropEffect = "none";
  };
  window.addEventListener("dragover", block);
  window.addEventListener("drop", block);
}
