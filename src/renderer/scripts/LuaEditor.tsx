import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { autocompletion, closeBrackets, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { BEAMNG_API, CONTROLLER_HOOKS, ELECTRICS, LUA_GLOBALS } from '@shared/lua/api';
import { checkLua } from '@shared/lua/check';
import styles from './Scripts.module.css';

/**
 * The Lua editor (fork): CodeMirror with Lua highlighting, the checker's
 * problems as you type, completions for BeamNG's vehicle API (and electrics
 * values after electrics.values.), and help on hover.
 */

export interface LuaEditorHandle {
  goToLine(line: number): void;
  focus(): void;
}

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
  { tag: tags.number, color: 'var(--warning)' },
  { tag: tags.comment, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: [tags.bool, tags.null, tags.atom], color: 'var(--warning)' },
  { tag: tags.operator, color: 'var(--text-1)' },
  { tag: tags.variableName, color: 'var(--text-0)' },
  { tag: tags.standard(tags.variableName), color: 'var(--cat-mechanical)' },
]);

const theme = EditorView.theme(
  {
    '&': { height: '100%', color: 'var(--text-0)', backgroundColor: 'var(--bg-1)', fontSize: 'var(--text-control)' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: 'var(--line-normal)' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-gutters': { backgroundColor: 'var(--bg-2)', color: 'var(--text-2)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--bg-3)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-dim)' },
    '.cm-tooltip': { backgroundColor: 'var(--bg-3)', color: 'var(--text-0)', border: 'var(--border-width) solid var(--border-1)', borderRadius: 'var(--radius-sm)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--text-on-accent)' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' },
    '.cm-diagnostic-info': { borderLeftColor: 'var(--accent)' },
    '.cm-panels': { backgroundColor: 'var(--bg-2)', color: 'var(--text-0)' },
  },
  { dark: true },
);

/** Completion options for the word before the cursor. */
export function luaCompletions(before: string): { label: string; type: string; detail?: string; info?: string }[] {
  if (/electrics\.values\.\w*$/.test(before) || /electrics\.values\[["']\w*$/.test(before)) return ELECTRICS.map((e) => ({ label: e.name, type: 'property', detail: e.unit ?? '', info: e.doc }));
  const member = /([A-Za-z_][\w]*)([.:])\w*$/.exec(before);
  if (member) {
    const [, base, sep] = member;
    if (base === 'M') return CONTROLLER_HOOKS.map((h) => ({ label: h.name, type: 'function', detail: h.sig, info: h.doc }));
    return BEAMNG_API.filter((e) => e.name.startsWith(`${base}${sep}`) && !e.name.slice(base!.length + 1).includes('.')).map((e) => ({ label: e.name.slice(base!.length + 1), type: e.kind === 'method' || e.kind === 'function' ? 'function' : 'property', detail: e.sig, info: e.doc }));
  }
  return [
    ...BEAMNG_API.filter((e) => !e.name.includes('.') && !e.name.includes(':')).map((e) => ({ label: e.name, type: e.kind === 'function' ? 'function' : 'variable', detail: e.sig, info: e.doc })),
    ...LUA_GLOBALS.map((g) => ({ label: g, type: 'keyword' })),
    ...['local', 'function', 'return', 'then', 'elseif', 'end', 'for', 'while', 'repeat', 'until', 'nil', 'true', 'false'].map((k) => ({ label: k, type: 'keyword' })),
  ];
}

function complete(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const word = ctx.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !ctx.explicit && !/[.:]$/.test(before))) return null;
  return { from: word.from, options: luaCompletions(before), validFor: /^\w*$/ };
}

const hover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let a = pos - line.from;
  let b = a;
  while (a > 0 && /[\w.:]/.test(text[a - 1]!)) a--;
  while (b < text.length && /\w/.test(text[b]!)) b++;
  const word = text.slice(a, b);
  const entry = BEAMNG_API.find((e) => e.name === word) ?? ELECTRICS.map((e) => ({ name: `electrics.values.${e.name}`, sig: e.unit ?? '', doc: e.doc })).find((e) => e.name === word);
  if (!entry) return null;
  return {
    pos: line.from + a,
    end: line.from + b,
    above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = styles.hover!;
      const sig = document.createElement('code');
      sig.textContent = entry.sig || entry.name;
      const doc = document.createElement('div');
      doc.textContent = entry.doc;
      dom.append(sig, doc);
      return { dom };
    },
  };
});

const lint = linter((view) =>
  checkLua(view.state.doc.toString(), { controller: true }).diagnostics.map(
    (d): Diagnostic => ({ from: Math.min(d.from, view.state.doc.length), to: Math.min(Math.max(d.to, d.from + 1), view.state.doc.length), severity: d.severity, message: d.message }),
  ),
);

export const LuaEditor = forwardRef<LuaEditorHandle, { value: string; onChange?: (code: string) => void; readOnly?: boolean; 'aria-label'?: string }>(function LuaEditor({ value, onChange, readOnly = false, 'aria-label': ariaLabel }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editable = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          StreamLanguage.define(lua),
          syntaxHighlighting(highlight),
          autocompletion({ override: [complete] }),
          lintGutter(),
          lint,
          hover,
          theme,
          EditorState.tabSize.of(2),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Lua code' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is made once; value and readOnly changes are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside changes (undo, reset to the template, another script) replace the text.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useImperativeHandle(ref, () => ({
    goToLine(line: number) {
      const v = view.current;
      if (!v) return;
      const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
      v.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
      v.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div ref={host} className={styles.editor} data-testid="lua-editor" />;
});
