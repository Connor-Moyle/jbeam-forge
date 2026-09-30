import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, MousePointerClick, X } from 'lucide-react';
import { useShell } from '@renderer/shell/ShellContext';
import { useDialogStore } from '@renderer/app/stores/dialogs';
import { Button } from '@renderer/ui/components/Button';
import { iconSize } from '@renderer/ui/tokens';
import { endTutorial, tourSteps, useTour, type TourContext } from './tutorial';
import styles from './Tour.module.css';

/** How often a waiting step checks whether it's done, and the target moved. */
const POLL_MS = 250;
const GAP = 12;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The guided tour's overlay: a spotlight on the button to press and a small
 * card beside it. The rest of the app stays usable (clicks go through).
 */
export function TourOverlay() {
  const step = useTour((s) => s.step);
  const { preset, applyPreset } = useShell();
  const ctx: TourContext = useMemo(() => ({ preset, applyPreset }), [preset, applyPreset]);
  const ctxRef = useRef(ctx);
  useLayoutEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);
  const steps = useMemo(() => (step === null ? [] : tourSteps()), [step]);
  const current = step === null ? null : steps[step];
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);

  const go = (to: number) => {
    const all = tourSteps();
    let i = to;
    const forward = step === null || to >= step;
    while (i >= 0 && i < all.length && all[i]!.skipIf?.(ctxRef.current)) i += forward ? 1 : -1;
    if (i >= all.length) endTutorial(false);
    else useTour.getState().set({ step: Math.max(0, i) });
  };

  // Entering a step.
  useEffect(() => {
    if (!current) return;
    current.enter?.(ctxRef.current);
  }, [current]);

  // Follow the target and move on when the step is done.
  useEffect(() => {
    if (!current || step === null) return;
    const tick = () => {
      if (current.done?.(ctxRef.current)) {
        go(step + 1);
        return;
      }
      const el = current.target ? document.querySelector<HTMLElement>(current.target) : null;
      const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
      setBox((prev) => {
        if (!r || r.width === 0) return prev === null ? prev : null;
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        return prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next;
      });
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
    // go only reads the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, step, preset]);

  // Place the card beside the spotlight (below, above, right or left: whichever fits), else centred.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.min(Math.max(GAP, x), vw - w - GAP);
    const clampY = (y: number) => Math.min(Math.max(GAP, y), vh - h - GAP);
    if (!box) {
      setCardPos({ top: (vh - h) / 2, left: (vw - w) / 2 });
      return;
    }
    const big = box.width > vw * 0.4 && box.height > vh * 0.4;
    if (big) setCardPos({ top: clampY(box.top + GAP * 2), left: clampX(box.left + box.width - w - GAP * 2) });
    else if (box.top + box.height + GAP + h < vh) setCardPos({ top: box.top + box.height + GAP, left: clampX(box.left + box.width / 2 - w / 2) });
    else if (box.top - GAP - h > 0) setCardPos({ top: box.top - GAP - h, left: clampX(box.left + box.width / 2 - w / 2) });
    else if (box.left + box.width + GAP + w < vw) setCardPos({ top: clampY(box.top), left: box.left + box.width + GAP });
    else setCardPos({ top: clampY(box.top), left: clampX(box.left - GAP - w) });
  }, [box, step]);

  if (!current || step === null) return null;
  const last = step === steps.length - 1;
  const waiting = !!current.done;

  return createPortal(
    <div className={styles.layer} data-testid="tour">
      {box ? (
        <div className={styles.spotlight} style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }} />
      ) : (
        <div className={styles.dim} />
      )}
      <div ref={card} className={styles.card} style={cardPos ?? { visibility: 'hidden' }} role="dialog" aria-label={current.title} data-testid="tour-card" data-step={current.id}>
        <div className={styles.head}>
          <span className={styles.count}>
            {step + 1} / {steps.length}
          </span>
          <button type="button" className={styles.close} onClick={() => endTutorial(false)} aria-label="Skip the tutorial" title="Skip the tutorial">
            <X aria-hidden />
          </button>
        </div>
        <h3 className={styles.title}>{current.title}</h3>
        <p className={styles.body}>{current.body}</p>
        {current.action && (
          <p className={styles.action} data-testid="tour-action">
            <MousePointerClick size={iconSize('size-icon-sm')} aria-hidden className={styles.actionIcon} />
            <span>
              <span className={styles.actionLabel}>Your turn: </span>
              {current.action}
            </span>
          </p>
        )}
        <div className={styles.buttons}>
          {step === 0 ? (
            <Button variant="ghost" onClick={() => endTutorial(true)} data-testid="tour-skip">
              Skip tutorial
            </Button>
          ) : (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => go(step - 1)} data-testid="tour-back">
              Back
            </Button>
          )}
          <span className={styles.spacer} />
          {last ? (
            <>
              <Button
                onClick={() => {
                  endTutorial(true);
                  useDialogStore.getState().setNewModOpen(true);
                }}
                data-testid="tour-own-mod"
              >
                Start my own mod
              </Button>
              <Button variant="primary" onClick={() => endTutorial(false)} data-testid="tour-finish">
                Keep exploring
              </Button>
            </>
          ) : (
            <Button variant={waiting ? 'default' : 'primary'} icon={ArrowRight} onClick={() => go(step + 1)} data-testid="tour-next">
              {step === 0 ? 'Start' : waiting ? 'Skip step' : 'Next'}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
