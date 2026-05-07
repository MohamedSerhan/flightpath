import type { SourceAdapter } from "./types.ts";
import { jsfirmAdapter } from "./adapters/jsfirm.ts";
import { breezyAdapter } from "./adapters/breezy.ts";

export const adapters: SourceAdapter[] = [jsfirmAdapter, breezyAdapter];
