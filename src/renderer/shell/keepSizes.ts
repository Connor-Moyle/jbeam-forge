import type { DockviewApi, DockviewGroupPanel } from 'dockview-core';

/**
 * Closing or opening a side panel changes the 3D view, not the other panels. The dock shares a
 * closed panel's room among all its neighbours (closing Properties more than doubled the Scene
 * panel), so the sizes are noted whenever the layout settles and put back after a panel comes or
 * goes; the group holding the 3D view is left to take up the difference.
 */
export interface SizeKeeper {
  /** Run a whole rebuild (a workspace, a stored layout) without putting old sizes back after it. */
  during(fn: () => void): void;
  dispose(): void;
}

type Size = { width: number; height: number };

const holdsViewport = (g: DockviewGroupPanel) => g.panels.some((p) => p.id === 'viewport');

export function keepSideSizes(api: DockviewApi): SizeKeeper {
  let sizes = new Map<string, Size>();
  let frame = 0;
  let paused = 0;
  let restoring = false;

  const note = () => {
    sizes = new Map(api.groups.map((g) => [g.id, { width: g.width, height: g.height }]));
  };
  // After the dock has laid itself out: a frame later.
  const noteSoon = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(note);
  };

  const restore = (saved: Map<string, Size>) => {
    requestAnimationFrame(() => {
      if (paused) return;
      restoring = true;
      try {
        for (const g of api.groups) {
          const was = saved.get(g.id);
          if (!was || holdsViewport(g)) continue;
          const dw = Math.abs(g.width - was.width) > 1;
          const dh = Math.abs(g.height - was.height) > 1;
          if (dw || dh) g.api.setSize({ ...(dw ? { width: was.width } : {}), ...(dh ? { height: was.height } : {}) });
        }
      } finally {
        restoring = false;
      }
      note();
    });
  };

  const changed = () => {
    if (paused) return;
    // A panel came or went: everything else back as it was (the sizes noted before the change).
    const saved = sizes;
    restore(saved);
  };

  const subs = [
    api.onDidLayoutChange(() => {
      if (!paused && !restoring) noteSoon();
    }),
    api.onDidRemoveGroup(changed),
    api.onDidAddGroup(changed),
  ];
  note();

  return {
    during(fn) {
      paused++;
      try {
        fn();
      } finally {
        paused--;
        cancelAnimationFrame(frame);
        // Note the new layout once it's drawn.
        requestAnimationFrame(note);
      }
    },
    dispose() {
      cancelAnimationFrame(frame);
      for (const s of subs) s.dispose();
    },
  };
}
