import { createContext, useContext } from "react";
import type { DuckEnvelope } from "./audioMix";

/** Ducking envelope of the current <AdVideo> (absolute output frames). */
export const DuckContext = createContext<DuckEnvelope>(() => 0);
export const useDuckEnvelope = () => useContext(DuckContext);
