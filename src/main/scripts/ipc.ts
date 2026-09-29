import { shell } from "electron";
import { z } from "zod";
import { LibraryScriptSchema } from "@shared/lua/types";
import { registerInvoke } from "../ipc/register";
import type { ScriptLibrary } from "./library";

export function registerScriptHandlers(library: ScriptLibrary): void {
  registerInvoke("scripts:library", () => library.list());
  registerInvoke(
    "scripts:save",
    ({ entry }) => library.save(entry),
    z.object({ entry: LibraryScriptSchema }),
  );
  registerInvoke(
    "scripts:delete",
    async ({ path }) => {
      await library.remove(path);
      return undefined;
    },
    z.object({ path: z.string().min(1).max(4096) }),
  );
  registerInvoke("scripts:reveal", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(library.dir, { recursive: true });
    await shell.openPath(library.dir);
    return undefined;
  });
}
