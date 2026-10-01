import { confirmDelete } from "@renderer/app/confirm";
import { useMemo, useRef, useState } from "react";
import {
  BookMarked,
  Code2,
  Download,
  FileCode,
  GraduationCap,
  Plus,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { BEAMNG_API, CONTROLLER_HOOKS, ELECTRICS } from "@shared/lua/api";
import { checkLua } from "@shared/lua/check";
import {
  outputName,
  scriptActions,
  type ParamDef,
  type ScriptTemplate,
} from "@shared/lua/templates";
import type {
  ScriptAction,
  ScriptParamValue,
  VehicleScript,
} from "@shared/lua/types";
import { EMPTY_ARR } from "@shared/empty";
import { SET_KINDS } from "@shared/export/jbeam";
import { useProjectStore } from "@renderer/app/stores/project";
import { useSceneStore } from "@renderer/app/stores/scene";
import { Button } from "@renderer/ui/components/Button";
import { CollapsibleSection } from "@renderer/ui/components/CollapsibleSection";
import { EmptyState } from "@renderer/ui/components/EmptyState";
import { Field, FieldGroup } from "@renderer/ui/components/Field";
import { IconButton } from "@renderer/ui/components/IconButton";
import { Input } from "@renderer/ui/components/Input";
import { NumberInput } from "@renderer/ui/components/NumberInput";
import { ScrollArea } from "@renderer/ui/components/ScrollArea";
import { Select } from "@renderer/ui/components/Select";
import { Slider } from "@renderer/ui/components/Slider";
import { Textarea } from "@renderer/ui/components/Textarea";
import { Toggle } from "@renderer/ui/components/Toggle";
import {
  customiseCode,
  doorSignals,
  exportLua,
  removeScript,
  renameScript,
  resetCode,
  saveToLibrary,
  setScriptParam,
  shareScript,
  updateScript,
  useScriptUi,
} from "./commands";
import { LuaEditor, type LuaEditorHandle } from "./LuaEditor";
import { templateById } from "./registry";
import { KeyCapture } from "./KeyCapture";
import { useGuide } from "@renderer/help/guide";
import { scriptLesson } from "@renderer/help/lessons/scriptLesson";
import styles from "./Scripts.module.css";

const BODY = "__body__";

/** One script: its settings (easy mode) or its code (advanced), its keys and what it outputs. */
export function ScriptPanel() {
  const selected = useScriptUi((s) => s.selected);
  const mode = useScriptUi((s) => s.mode);
  const script = useProjectStore(
    (s) => s.doc?.scripts?.find((x) => x.id === selected) ?? null,
  );
  if (!script)
    return (
      <EmptyState
        icon={FileCode}
        message="Pick a script on the left, or add one from the templates."
      />
    );
  const template = script.templateId
    ? templateById(script.templateId)
    : undefined;
  return (
    <div className={styles.panel} data-testid="script-panel">
      <Header key={`${script.id}:${script.name}`} script={script} />
      <div className={styles.tabsRow} role="tablist" aria-label="Script view">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "easy"}
          className={mode === "easy" ? styles.tabOn : styles.tab}
          onClick={() => useScriptUi.getState().set({ mode: "easy" })}
          data-testid="script-mode-easy"
        >
          <SlidersHorizontal className={styles.icon} aria-hidden /> Set up
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "code"}
          className={mode === "code" ? styles.tabOn : styles.tab}
          onClick={() => useScriptUi.getState().set({ mode: "code" })}
          data-testid="script-mode-code"
        >
          <Code2 className={styles.icon} aria-hidden /> Code
        </button>
      </div>
      {mode === "easy" ? (
        <Easy script={script} template={template} />
      ) : (
        <CodeView script={script} template={template} />
      )}
    </div>
  );
}

function Header({ script }: { script: VehicleScript }) {
  const parts = useProjectStore((s) => s.doc?.parts ?? EMPTY_ARR);
  const [name, setName] = useState(script.name);
  const [bad, setBad] = useState(false);
  return (
    <div className={styles.header}>
      <div className={styles.row}>
        <Input
          value={script.label}
          onChange={(e) =>
            updateScript(script.id, { label: e.target.value || "Script" })
          }
          aria-label="Script name"
          className={styles.grow}
          data-testid="script-label"
        />
        {script.templateId && (
          <IconButton
            icon={GraduationCap}
            label="Tutorial: how to set it up and what every line of its code does"
            onClick={() => {
              const t = templateById(script.templateId ?? "");
              if (t) useGuide.getState().start(scriptLesson(t, script.id));
            }}
            data-testid="script-tutorial"
          />
        )}
        <IconButton
          icon={Trash2}
          label="Remove this script (and the animations it drives)"
          onClick={() =>
            void confirmDelete(
              script.label,
              "The animations it drives go too. You can undo this with Ctrl+Z.",
            ).then((yes) => yes && removeScript(script.id))
          }
          data-testid="script-remove"
        />
      </div>
      <div className={styles.row}>
        <Input
          mono
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setBad(false);
          }}
          onBlur={() => {
            if (name !== script.name && !renameScript(script.id, name))
              setBad(true);
          }}
          invalid={bad}
          aria-label="Controller name"
          className={styles.grow}
        />
        <Select
          value={script.partId ?? BODY}
          onChange={(v) =>
            updateScript(
              script.id,
              { partId: v === BODY ? null : v },
              "Move script to another part",
            )
          }
          options={[
            { value: BODY, label: "On the body" },
            ...parts
              .filter((p) => !p.variantOf && !SET_KINDS.has(p.taxonomyId))
              .map((p) => ({ value: p.id, label: `With ${p.displayName}` })),
          ]}
          aria-label="Part it comes with"
          className={styles.grow}
        />
      </div>
      {bad && (
        <p className={styles.error}>
          Lower-case letters, digits and _, starting with a letter, and not used
          by another script.
        </p>
      )}
    </div>
  );
}

function meshLabel(key: string): string {
  for (const src of Object.values(useSceneStore.getState().sources)) {
    const m = src.meshes.find((x) => x.key === key);
    if (m) return m.name;
  }
  return key.split(":").pop() ?? key;
}

function MeshPicker({
  value,
  single,
  onChange,
}: {
  value: string[];
  single?: boolean;
  onChange: (keys: string[]) => void;
}) {
  const selection = useSceneStore((s) => s.selection);
  const pick = () =>
    onChange(
      single ? selection.slice(0, 1) : [...new Set([...value, ...selection])],
    );
  return (
    <div className={styles.meshes}>
      {value.length > 0 && (
        <ul className={styles.chips}>
          {value.map((k) => (
            <li key={k} className={styles.chip}>
              <span>{meshLabel(k)}</span>
              <button
                type="button"
                className={styles.chipX}
                onClick={() => onChange(value.filter((x) => x !== k))}
                aria-label={`Remove ${meshLabel(k)}`}
              >
                <X aria-hidden className={styles.icon} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.row}>
        <Button
          size="sm"
          onClick={pick}
          disabled={!selection.length}
          data-testid="script-use-selection"
        >
          {single
            ? "Use the selected mesh"
            : `Add the selected meshes${selection.length ? ` (${selection.length})` : ""}`}
        </Button>
        {value.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => useSceneStore.getState().select(value)}
          >
            Show them
          </Button>
        )}
      </div>
      {!selection.length && (
        <p className={styles.note}>
          Select meshes in the viewport or the Scene list first.
        </p>
      )}
    </div>
  );
}

function ParamField({ script, p }: { script: VehicleScript; p: ParamDef }) {
  const doc = useProjectStore((s) => s.doc);
  const v: ScriptParamValue = script.params[p.id] ?? p.default;
  const set = (x: ScriptParamValue) => setScriptParam(script.id, p.id, x);
  let control: React.ReactNode;
  switch (p.kind) {
    case "number": {
      const n = typeof v === "number" ? v : Number(p.default);
      control = (
        <div className={styles.numberRow}>
          <Slider
            value={n}
            onChange={set}
            min={p.min ?? 0}
            max={p.max ?? 100}
            step={p.step ?? 1}
            format={(x) => `${+x.toFixed(3)}${p.unit ? ` ${p.unit}` : ""}`}
            aria-label={p.label}
          />
          <NumberInput
            value={n}
            onChange={set}
            min={p.min}
            max={p.max}
            step={p.step ?? 1}
            precision={(p.step ?? 1) < 1 ? 3 : 0}
            aria-label={`${p.label} value`}
          />
        </div>
      );
      break;
    }
    case "boolean":
      return <Toggle checked={v === true} onChange={set} label={p.label} />;
    case "choice":
      control = (
        <Select
          value={String(v)}
          onChange={set}
          options={p.options ?? []}
          aria-label={p.label}
        />
      );
      break;
    case "meshes":
      control = <MeshPicker value={Array.isArray(v) ? v : []} onChange={set} />;
      break;
    case "mesh":
      control = (
        <MeshPicker
          single
          value={typeof v === "string" && v ? [v] : []}
          onChange={(k) => set(k[0] ?? "")}
        />
      );
      break;
    case "electrics": {
      const id = `${script.id}-${p.id}-list`;
      control = (
        <>
          <Input
            mono
            value={String(v)}
            onChange={(e) => set(e.target.value.trim())}
            list={id}
            aria-label={p.label}
          />
          <datalist id={id}>
            {[...doorSignals(doc), ...ELECTRICS.map((e) => e.name)].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </>
      );
      break;
    }
    default:
      control =
        String(v).includes("\n") || p.id === "tracks" ? (
          <Textarea
            value={String(v)}
            onChange={(e) => set(e.target.value)}
            rows={5}
            aria-label={p.label}
          />
        ) : (
          <Input
            value={String(v)}
            onChange={(e) => set(e.target.value)}
            aria-label={p.label}
          />
        );
  }
  return (
    <Field label={p.label} hint={p.hint}>
      {control}
    </Field>
  );
}

function Easy({
  script,
  template,
}: {
  script: VehicleScript;
  template: ScriptTemplate | undefined;
}) {
  const actions = scriptActions(template ?? null, script);
  return (
    <ScrollArea className={styles.scroll}>
      <div className={styles.body} data-testid="script-easy">
        {template ? (
          <>
            <p className={styles.cardText}>{template.description}</p>
            {script.code !== null && (
              <p className={styles.warn}>
                Its code has been edited in the Code tab; these settings still
                reach it as jbeam data.
              </p>
            )}
            <FieldGroup title="Settings">
              {template.params
                .filter((p) => !p.advanced)
                .map((p) => (
                  <ParamField key={p.id} script={script} p={p} />
                ))}
            </FieldGroup>
            {template.params.some((p) => p.advanced) && (
              <CollapsibleSection
                id="script-more-settings"
                title="More settings"
              >
                {template.params
                  .filter((p) => p.advanced)
                  .map((p) => (
                    <ParamField key={p.id} script={script} p={p} />
                  ))}
              </CollapsibleSection>
            )}
          </>
        ) : (
          <>
            <p className={styles.cardText}>
              Written by hand: edit it in the Code tab. Settings below reach it
              as jbeamData (the controller&rsquo;s row in the jbeam).
            </p>
            <CustomSettings script={script} />
          </>
        )}
        <div data-testid="script-keys">
          <FieldGroup title="Keys">
            {!actions.length && !template && (
              <p className={styles.note}>
                Add a key to call one of the script&rsquo;s functions (M.toggle,
                M.set…) in game.
              </p>
            )}
            {actions.map((a, i) => (
              <ActionRow
                key={a.id}
                script={script}
                template={template}
                action={a}
                index={i}
              />
            ))}
            {!template && (
              <Button
                size="sm"
                icon={Plus}
                onClick={() =>
                  updateScript(
                    script.id,
                    {
                      actions: [
                        ...(script.actions ?? []),
                        {
                          id: `action${(script.actions?.length ?? 0) + 1}`,
                          label: `${script.label}: action`,
                          key: "",
                          call: "toggle()",
                        },
                      ],
                    },
                    "Add key",
                  )
                }
              >
                Add a key
              </Button>
            )}
            <p className={styles.note}>
              Click a key, then press the one you want. Players can change them
              in the game under Options → Controls → Vehicle specific; if a key
              does nothing in game, another control may already use it there.
            </p>
          </FieldGroup>
        </div>
        {template && (
          <div data-testid="script-outputs">
            <FieldGroup title="What it outputs">
              <ul className={styles.outputs}>
                {template.outputs.map((o) => (
                  <li key={o.suffix}>
                    <code>{outputName(script.name, o.suffix)}</code>{" "}
                    <span className={styles.note}>{o.label}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.note}>
                Electrics values: animated parts, light materials and gauges can
                use them.
              </p>
            </FieldGroup>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function ActionRow({
  script,
  template,
  action,
  index,
}: {
  script: VehicleScript;
  template: ScriptTemplate | undefined;
  action: ScriptAction;
  index: number;
}) {
  const setKey = (key: string) => {
    const list = scriptActions(template ?? null, script).map((a) =>
      a.id === action.id ? { ...a, key } : a,
    );
    updateScript(script.id, { actions: list }, "Change key");
  };
  if (template) {
    return (
      <Field label={action.label}>
        <KeyCapture value={action.key} onChange={setKey} label={action.label} />
      </Field>
    );
  }
  const patch = (p: Partial<ScriptAction>) =>
    updateScript(
      script.id,
      {
        actions: (script.actions ?? []).map((a, i) =>
          i === index ? { ...a, ...p } : a,
        ),
      },
      "Change key",
    );
  return (
    <div className={styles.actionRow}>
      <Input
        value={action.label}
        onChange={(e) => patch({ label: e.target.value || "Action" })}
        aria-label="Key name"
      />
      <KeyCapture
        value={action.key}
        onChange={(key) => patch({ key })}
        label={action.label}
      />
      <Input
        mono
        value={action.call}
        onChange={(e) => patch({ call: e.target.value })}
        invalid={!/^[A-Za-z_]\w*\(.*\)$/.test(action.call)}
        aria-label="Calls"
      />
      <IconButton
        icon={X}
        label="Remove key"
        onClick={() =>
          updateScript(
            script.id,
            { actions: (script.actions ?? []).filter((_, i) => i !== index) },
            "Remove key",
          )
        }
      />
    </div>
  );
}

function CustomSettings({ script }: { script: VehicleScript }) {
  const entries = Object.entries(script.params).filter(
    ([, v]) => !Array.isArray(v),
  );
  const [key, setKey] = useState("");
  return (
    <FieldGroup title="Settings">
      {entries.map(([k, v]) => (
        <div key={k} className={styles.actionRow}>
          <code className={styles.grow}>{k}</code>
          <Input
            value={String(v)}
            onChange={(e) =>
              setScriptParam(
                script.id,
                k,
                e.target.value !== "" && !Number.isNaN(Number(e.target.value))
                  ? Number(e.target.value)
                  : e.target.value === "true"
                    ? true
                    : e.target.value === "false"
                      ? false
                      : e.target.value,
              )
            }
            aria-label={`${k} value`}
          />
          <IconButton
            icon={X}
            label="Remove setting"
            onClick={() => {
              const params = { ...script.params };
              delete params[k];
              updateScript(script.id, { params }, "Remove setting");
            }}
          />
        </div>
      ))}
      <div className={styles.row}>
        <Input
          mono
          value={key}
          onChange={(e) => setKey(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
          placeholder="newSetting"
          aria-label="New setting name"
          className={styles.grow}
        />
        <Button
          size="sm"
          icon={Plus}
          disabled={!key || key in script.params}
          onClick={() => {
            setScriptParam(script.id, key, 0);
            setKey("");
          }}
        >
          Add
        </Button>
      </div>
    </FieldGroup>
  );
}

function CodeView({
  script,
  template,
}: {
  script: VehicleScript;
  template: ScriptTemplate | undefined;
}) {
  const editor = useRef<LuaEditorHandle>(null);
  const code = script.code ?? template?.lua ?? "";
  const locked = script.code === null && !!template;
  const problems = useMemo(
    () => checkLua(code, { controller: true }).diagnostics,
    [code],
  );
  const [ref, setRef] = useState("");
  return (
    <div className={styles.codeView} data-testid="script-code">
      <div className={styles.row}>
        {locked ? (
          <Button
            size="sm"
            variant="primary"
            icon={Code2}
            onClick={() => customiseCode(script.id)}
            data-testid="script-customise"
          >
            Customise the code
          </Button>
        ) : (
          template && (
            <Button
              size="sm"
              icon={RotateCcw}
              onClick={() => resetCode(script.id)}
            >
              Back to the template&rsquo;s code
            </Button>
          )
        )}
        <span className={styles.grow} />
        <IconButton
          icon={BookMarked}
          label="Save to my library"
          onClick={() => void saveToLibrary(script.id)}
          data-testid="script-save-library"
        />
        <IconButton
          icon={Share2}
          label="Save as a .jbscript to share"
          onClick={() => void shareScript(script.id)}
        />
        <IconButton
          icon={Download}
          label="Save the .lua"
          onClick={() => void exportLua(script.id)}
        />
      </div>
      {locked && (
        <p className={styles.note}>
          The template&rsquo;s own code (read-only). Customise it to change it
          for this car.
        </p>
      )}
      <div className={styles.editorWrap}>
        <LuaEditor
          ref={editor}
          value={code}
          readOnly={locked}
          onChange={(next) =>
            updateScript(script.id, { code: next }, "Edit script code")
          }
          aria-label={`${script.name}.lua`}
        />
      </div>
      <div className={styles.problems} data-testid="script-problems">
        {problems.length === 0 ? (
          <span className={styles.ok}>No problems found.</span>
        ) : (
          problems.map((d, i) => (
            <button
              key={i}
              type="button"
              className={
                d.severity === "error"
                  ? styles.problemError
                  : d.severity === "warning"
                    ? styles.problemWarn
                    : styles.problemInfo
              }
              onClick={() => editor.current?.goToLine(d.line)}
            >
              <span className={styles.mono}>{d.line}</span> {d.message}
            </button>
          ))
        )}
      </div>
      <CollapsibleSection
        id="script-reference"
        title="Reference: what vehicle Lua can use"
      >
        <Input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Search the reference"
          aria-label="Search the reference"
        />
        <dl className={styles.reference}>
          {[
            ...CONTROLLER_HOOKS.map((h) => ({
              name: `M.${h.name}`,
              sig: h.sig,
              doc: h.doc,
            })),
            ...BEAMNG_API,
            ...ELECTRICS.map((e) => ({
              name: `electrics.values.${e.name}`,
              sig: e.unit ?? "",
              doc: e.doc,
            })),
          ]
            .filter(
              (e) =>
                !ref ||
                `${e.name} ${e.doc}`.toLowerCase().includes(ref.toLowerCase()),
            )
            .slice(0, 80)
            .map((e) => (
              <div key={e.name} className={styles.refRow}>
                <dt className={styles.mono}>
                  {e.sig && e.sig !== "table" && e.sig !== "number"
                    ? e.sig
                    : e.name}
                </dt>
                <dd>{e.doc}</dd>
              </div>
            ))}
        </dl>
      </CollapsibleSection>
    </div>
  );
}
