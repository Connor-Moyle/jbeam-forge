import { create } from 'zustand';
import type { ExplainedLine } from '@shared/lua/explain';
import { call } from '@renderer/diagnostics/ipc';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { useTour } from './tutorial';

/**
 * Guided lessons (script templates, triggers, moving parts, the JBeam
 * workspace): steps with a spotlight on the control to use, a short text,
 * lists of what each setting or key is, and code shown line by line with
 * what every line does. Offered once with Watch or Skip, and replayable.
 */

export interface GuideStep {
  id: string;
  title: string;
  body: string;
  /** What to highlight (a CSS selector); none centres the card. */
  target?: string;
  /** Said under the text when the step waits for the user. */
  action?: string;
  /** Done: moves on by itself. */
  done?: () => boolean;
  /** Skipped when already true. */
  skipIf?: () => boolean;
  /** Run when the step opens. */
  enter?: () => void;
  /** Named things with what each is (settings, keys, outputs…). */
  list?: { label: string; text: string }[];
  /** Code shown line by line with a note for each line. */
  code?: ExplainedLine[];
}

export interface Guide {
  /** Remembered once seen (e.g. "script:wipers"). */
  id: string;
  title: string;
  steps: GuideStep[];
}

interface GuideState {
  guide: Guide | null;
  step: number;
  start: (guide: Guide) => void;
  go: (step: number) => void;
  end: () => void;
}

export const useGuide = create<GuideState>()((set, get) => ({
  guide: null,
  step: 0,
  start: (guide) => {
    markSeen(guide.id);
    useGuideOffer.getState().close();
    set({ guide, step: 0 });
  },
  go: (step) => {
    const g = get().guide;
    if (!g) return;
    const forward = step >= get().step;
    let i = step;
    while (i >= 0 && i < g.steps.length && g.steps[i]!.skipIf?.()) i += forward ? 1 : -1;
    if (i >= g.steps.length) set({ guide: null, step: 0 });
    else set({ step: Math.max(0, i) });
  },
  end: () => set({ guide: null, step: 0 }),
}));

/** "Watch the tutorial for …?" with Watch and Skip. */
export interface GuideOfferState {
  offer: { id: string; title: string; summary: string; build: () => Guide } | null;
  show: (offer: NonNullable<GuideOfferState['offer']>) => void;
  close: () => void;
}

export const useGuideOffer = create<GuideOfferState>()((set) => ({
  offer: null,
  show: (offer) => set({ offer }),
  close: () => set({ offer: null }),
}));

export function guideSeen(id: string): boolean {
  return useSettingsStore.getState().settings?.lessonsSeen?.includes(id) ?? false;
}

function markSeen(id: string): void {
  const seen = useSettingsStore.getState().settings?.lessonsSeen ?? [];
  if (seen.includes(id)) return;
  call('settings:update', { lessonsSeen: [...seen, id].slice(-500) }).catch(() => undefined);
}

/** Offer a lesson the first time (unless lessons are switched off in Settings); Skip remembers it too. */
export function offerGuide(offer: NonNullable<GuideOfferState['offer']>): void {
  const s = useSettingsStore.getState().settings;
  if (s && !s.offerLessons) return;
  // Not over the first-run tour, nor over another lesson.
  if (guideSeen(offer.id) || useGuide.getState().guide || useTour.getState().step !== null) return;
  useGuideOffer.getState().show(offer);
}

export function skipOffer(): void {
  const o = useGuideOffer.getState().offer;
  if (o) markSeen(o.id);
  useGuideOffer.getState().close();
}
