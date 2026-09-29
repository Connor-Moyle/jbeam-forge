import { z } from 'zod';
import { ScriptActionSchema, ScriptParamValueSchema } from '../lua/types';
import type { ScriptTemplate } from '../lua/templates';

/**
 * Extensions (fork): the user's own add-ons for JBeam Forge. An extension is
 * a folder with extension.json and a JavaScript file; it runs in a worker of
 * its own (no files, no network, no window) and talks to the app through
 * `forge`: add commands (Command Palette → Extensions), add vehicle script
 * templates to the Scripts tab, read the project, change it with checked,
 * undoable edits, and show messages. See docs/extensions.md.
 */

export const EXTENSION_ID = /^[a-z][a-z0-9-]{1,39}$/;

export const ExtensionManifestSchema = z.object({
  id: z.string().regex(EXTENSION_ID),
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(40),
  description: z.string().max(2000).default(''),
  author: z.string().max(120).optional(),
  /** The script to run, relative to the folder. */
  main: z.string().regex(/^[\w./-]{1,200}\.js$/).default('main.js'),
});
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;

export interface ExtensionInfo {
  manifest: ExtensionManifest | null;
  folder: string;
  code: string | null;
  error: string | null;
}

/** One edit to the project: JSON Patch (RFC 6902) add, remove, replace. */
export const PatchOpSchema = z.object({
  op: z.enum(['add', 'remove', 'replace']),
  path: z.string().regex(/^(\/[^/]*)+$/),
  value: z.unknown().optional(),
});
export type PatchOp = z.infer<typeof PatchOpSchema>;

const unescape = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');

/** Apply patch operations to a copy; throws with a readable message. */
export function applyPatch<T>(doc: T, ops: readonly PatchOp[]): T {
  const out = structuredClone(doc) as unknown;
  for (const op of ops) {
    const keys = op.path.split('/').slice(1).map(unescape);
    if (keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) throw new Error(`Not allowed: ${op.path}`);
    let parent = out as Record<string, unknown> | unknown[];
    for (const k of keys.slice(0, -1)) {
      const next = Array.isArray(parent) ? parent[Number(k)] : parent[k];
      if (next === null || typeof next !== 'object') throw new Error(`${op.path}: ${k} isn't there`);
      parent = next as Record<string, unknown> | unknown[];
    }
    const last = keys[keys.length - 1]!;
    if (Array.isArray(parent)) {
      const i = last === '-' ? parent.length : Number(last);
      if (!Number.isInteger(i) || i < 0 || i > parent.length || (op.op !== 'add' && i >= parent.length)) throw new Error(`${op.path}: no item ${last}`);
      if (op.op === 'add') parent.splice(i, 0, structuredClone(op.value));
      else if (op.op === 'remove') parent.splice(i, 1);
      else parent[i] = structuredClone(op.value);
    } else {
      if (op.op !== 'add' && !(last in parent)) throw new Error(`${op.path}: nothing there`);
      if (op.op === 'remove') delete parent[last];
      else parent[last] = structuredClone(op.value);
    }
  }
  return out as T;
}

/** A vehicle script template from an extension (data only: no functions cross from its worker). */
export const ExtensionTemplateSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(40),
  description: z.string().max(2000),
  needs: z.string().max(200).optional(),
  name0: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  params: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
        label: z.string().min(1).max(80),
        hint: z.string().max(300).optional(),
        kind: z.enum(['number', 'boolean', 'choice', 'text', 'meshes', 'mesh', 'electrics']),
        default: ScriptParamValueSchema,
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().positive().optional(),
        unit: z.string().max(20).optional(),
        options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
        advanced: z.boolean().optional(),
        animate: z
          .object({
            output: z.string().max(30),
            motion: z.enum(['rotate', 'slide']),
            from: z.number(),
            to: z.number(),
            axis: z.tuple([z.number(), z.number(), z.number()]),
            pivot: z.enum(['centre', 'top', 'bottom', 'front', 'rear', 'left', 'right', 'inner']),
            mirror: z.boolean().optional(),
            toParam: z.string().optional(),
          })
          .optional(),
      }),
    )
    .max(40),
  outputs: z.array(z.object({ suffix: z.string().regex(/^[a-z0-9_]{0,20}$/), label: z.string().max(120), min: z.number(), max: z.number() })).max(20),
  actions: z.array(ScriptActionSchema.extend({ desc: z.string().max(200).default('') })).max(20),
  lua: z.string().min(1).max(200_000),
  test: z
    .object({
      seconds: z.number().positive().max(120),
      tracks: z.array(z.object({ name: z.string(), points: z.array(z.tuple([z.number(), z.number()])) })),
      presses: z.array(z.object({ at: z.number(), action: z.string() })),
    })
    .default({ seconds: 10, tracks: [], presses: [] }),
});

/** An extension's template, ready for the Scripts tab (its id kept apart from the built-in ones). */
export function extensionTemplate(extensionId: string, raw: unknown): ScriptTemplate {
  const t = ExtensionTemplateSchema.parse(raw);
  return { ...t, id: `ext_${extensionId.replace(/-/g, '_')}_${t.id}`, category: t.category as ScriptTemplate['category'], actions: t.actions.map((a) => ({ ...a, desc: a.desc })) };
}

/** Messages from an extension's worker to the app. */
export type FromExtension =
  | { type: 'command'; id: string; label: string }
  | { type: 'template'; template: unknown }
  | { type: 'notify'; message: string; tone?: 'info' | 'success' | 'warning' | 'danger' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'request'; reqId: number; method: 'project.get' | 'project.update' | 'settings.get'; args: unknown[] }
  | { type: 'ready' }
  | { type: 'error'; message: string };

/** Messages from the app to an extension's worker. */
export type ToExtension = { type: 'run'; id: string } | { type: 'reply'; reqId: number; ok: boolean; value?: unknown; error?: string } | { type: 'event'; name: 'projectChanged' | 'projectOpened' };

/**
 * The code that runs before an extension's own in its worker: the `forge`
 * object it uses. Plain JS (it's put in front of the extension's file).
 */
export const EXTENSION_BOOTSTRAP = `"use strict";
(function () {
  var post = function (m) { self.postMessage(m); };
  var commands = {};
  var listeners = {};
  var pending = {};
  var nextReq = 1;
  function request(method, args) {
    var reqId = nextReq++;
    return new Promise(function (resolve, reject) {
      pending[reqId] = { resolve: resolve, reject: reject };
      post({ type: "request", reqId: reqId, method: method, args: args });
    });
  }
  self.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.type === "run" && commands[m.id]) {
      Promise.resolve().then(function () { return commands[m.id](); }).catch(function (err) { post({ type: "error", message: "Command " + m.id + ": " + (err && err.message || String(err)) }); });
    } else if (m.type === "reply" && pending[m.reqId]) {
      var p = pending[m.reqId]; delete pending[m.reqId];
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || "failed"));
    } else if (m.type === "event") {
      (listeners[m.name] || []).forEach(function (fn) { try { fn(); } catch (err) { post({ type: "error", message: String(err && err.message || err) }); } });
    }
  });
  self.forge = Object.freeze({
    commands: Object.freeze({
      register: function (c) {
        if (!c || typeof c.id !== "string" || typeof c.run !== "function") throw new Error("forge.commands.register({ id, label, run })");
        commands[c.id] = c.run;
        post({ type: "command", id: c.id, label: String(c.label || c.id) });
      },
    }),
    scripts: Object.freeze({
      registerTemplate: function (t) { post({ type: "template", template: JSON.parse(JSON.stringify(t)) }); },
    }),
    project: Object.freeze({
      get: function () { return request("project.get", []); },
      update: function (label, ops) { return request("project.update", [String(label || "Extension edit"), ops]); },
    }),
    settings: Object.freeze({ get: function () { return request("settings.get", []); } }),
    ui: Object.freeze({ notify: function (message, tone) { post({ type: "notify", message: String(message), tone: tone }); } }),
    on: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    log: function () { post({ type: "log", level: "info", message: Array.prototype.map.call(arguments, String).join(" ") }); },
  });
  self.addEventListener("error", function (e) { post({ type: "error", message: e.message }); });
  self.addEventListener("unhandledrejection", function (e) { post({ type: "error", message: String(e.reason && e.reason.message || e.reason) }); });
})();
`;

/** The extension made by "New extension": a command and a script template, to start from. */
export const SAMPLE_EXTENSION = {
  manifest: { id: 'hello-extension', name: 'Hello extension', version: '1.0.0', description: 'A starting point: a command that counts the car’s parts, one that names unnamed parts, and a vehicle script template.', main: 'main.js' },
  main: `// JBeam Forge extension. Runs in its own worker: use the forge object.
// Reload it from Settings → Extensions after changing this file.

forge.commands.register({
  id: "count-parts",
  label: "Count parts and meshes",
  run: async () => {
    const doc = await forge.project.get();
    if (!doc) return forge.ui.notify("Open a project first.", "warning");
    forge.ui.notify(doc.parts.length + " parts, " + Object.keys(doc.assignments).length + " meshes assigned.", "success");
  },
});

forge.commands.register({
  id: "tidy-names",
  label: "Capitalise part names",
  run: async () => {
    const doc = await forge.project.get();
    if (!doc) return;
    // Edits are JSON Patch operations: checked against the project format, and undoable.
    const ops = doc.parts
      .map((p, i) => ({ i, name: p.displayName.replace(/\\b\\w/g, (c) => c.toUpperCase()), was: p.displayName }))
      .filter((x) => x.name !== x.was)
      .map((x) => ({ op: "replace", path: "/parts/" + x.i + "/displayName", value: x.name }));
    if (!ops.length) return forge.ui.notify("Every part name is already capitalised.");
    await forge.project.update("Capitalise part names", ops);
    forge.ui.notify("Renamed " + ops.length + " parts.", "success");
  },
});

// A vehicle script template: shows in Scripts → Templates.
forge.scripts.registerTemplate({
  id: "speed_warning",
  name: "Speed warning light",
  category: "Driving aids",
  description: "A warning light value that flashes above a set speed.",
  name0: "speedwarn",
  params: [{ id: "limit", label: "Flash above", kind: "number", default: 120, min: 20, max: 300, step: 5, unit: "km/h" }],
  outputs: [{ suffix: "", label: "Warning light (0/1)", min: 0, max: 1 }],
  actions: [],
  lua: [
    "local M = {}",
    "local out, limit, t = 'jbf_speedwarn', 120, 0",
    "local function init(jbeamData)",
    "  out = jbeamData.out or out",
    "  limit = jbeamData.limit or limit",
    "  t = 0",
    "end",
    "local function updateGFX(dt)",
    "  t = t + dt",
    "  local over = (electrics.values.wheelspeed or 0) * 3.6 > limit",
    "  electrics.values[out] = (over and math.floor(t * 4) % 2 == 0) and 1 or 0",
    "end",
    "M.init = init",
    "M.updateGFX = updateGFX",
    "return M",
  ].join("\\n"),
  test: { seconds: 10, tracks: [{ name: "wheelspeed", points: [[0, 0], [10, 45]] }], presses: [] },
});
`,
};
