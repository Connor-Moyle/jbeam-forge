import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { renameMesh } from './naming';

export const useRenameMeshUi = create<{ key: string | null; open: (key: string) => void; close: () => void }>()((set) => ({
  key: null,
  open: (key) => set({ key }),
  close: () => set({ key: null }),
}));

/** Rename one mesh. The name typed here is never replaced by automatic naming; clear it to go back. */
export function RenameMeshDialog() {
  const key = useRenameMeshUi((s) => s.key);
  if (!key) return null;
  return <RenameBody key={key} meshKey={key} />;
}

function RenameBody({ meshKey }: { meshKey: string }) {
  const close = useRenameMeshUi((s) => s.close);
  const entry = useProjectStore((s) => s.doc?.meshNames[meshKey]);
  const sources = useSceneStore((s) => s.sources);
  const original = useMemo(() => {
    for (const src of Object.values(sources)) {
      const m = src.meshes.find((x) => x.key === meshKey);
      if (m) return m.name;
    }
    return meshKey.slice(meshKey.indexOf(':') + 1);
  }, [sources, meshKey]);
  const [name, setName] = useState(entry?.name ?? original);
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    const err = renameMesh(meshKey, name === original ? '' : name);
    if (err) setProblem(err);
    else close();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Rename mesh"
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={save} data-testid="rename-mesh-save">
            Rename
          </Button>
        </>
      }
    >
      <Field label="Name" hint={problem ?? `Originally ${original}. Leave empty to use the automatic name.`}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} invalid={!!problem} data-testid="rename-mesh-input" />
      </Field>
    </Modal>
  );
}
