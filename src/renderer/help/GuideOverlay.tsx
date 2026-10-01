import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, GraduationCap, MousePointerClick, X } from 'lucide-react';
import { Button } from '@renderer/ui/components/Button';
import { iconSize } from '@renderer/ui/tokens';
import { skipOffer, useGuide, useGuideOffer } from './guide';
import tour from './Tour.module.css';
import styles from './Guide.module.css';

const POLL_MS = 250;
const GAP = 12;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * A guided lesson on screen: a spotlight on the control to use and a card
 * with the step (its list of settings or keys, or its code with a note on
 * every line). Clicks go through to the app, so you follow along for real.
 */
export function GuideOverlay() {
  const guide = useGuide((s) => s.guide);
  const step = useGuide((s) => s.step);
  const current = guide?.steps[step] ?? null;
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    current?.enter?.();
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const tick = () => {
      if (current.done?.()) {
        useGuide.getState().go(useGuide.getState().step + 1);
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
  }, [current]);

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
      setCardPos({ top: clampY((vh - h) / 2), left: clampX((vw - w) / 2) });
      return;
    }
    // Beside the spotlight where it fits (left or right first: code needs the height), else over it.
    if (box.left - GAP - w > 0) setCardPos({ top: clampY(box.top), left: box.left - GAP - w });
    else if (box.left + box.width + GAP + w < vw) setCardPos({ top: clampY(box.top), left: box.left + box.width + GAP });
    else if (box.top + box.height + GAP + h < vh) setCardPos({ top: box.top + box.height + GAP, left: clampX(box.left + box.width / 2 - w / 2) });
    else setCardPos({ top: clampY(box.top + GAP * 2), left: clampX(box.left + GAP * 2) });
  }, [box, step, current]);

  if (!guide || !current) return <GuideOffer />;
  const last = step === guide.steps.length - 1;
  const waiting = !!current.done;
  const go = useGuide.getState().go;

  return createPortal(
    <div className={tour.layer} data-testid="guide">
      {box ? <div className={tour.spotlight} style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }} /> : <div className={tour.dim} />}
      <div ref={card} className={`${tour.card} ${current.code ? styles.wide : ''}`} style={cardPos ?? { visibility: 'hidden' }} role="dialog" aria-label={current.title} data-testid="guide-card" data-step={current.id}>
        <div className={tour.head}>
          <span className={tour.count}>
            {guide.title} · {step + 1} / {guide.steps.length}
          </span>
          <button type="button" className={tour.close} onClick={() => useGuide.getState().end()} aria-label="Stop the tutorial" title="Stop the tutorial">
            <X aria-hidden />
          </button>
        </div>
        <h3 className={tour.title}>{current.title}</h3>
        <p className={tour.body}>{current.body}</p>
        {current.list && (
          <dl className={styles.list}>
            {current.list.map((item) => (
              <div key={item.label} className={styles.item}>
                <dt>{item.label}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
        )}
        {current.code && (
          <ol className={styles.code} data-testid="guide-code">
            {current.code.map((l) => (
              <li key={l.n} className={styles.line}>
                <span className={styles.lineNo}>{l.n}</span>
                <code className={styles.lineText}>{l.text.replace(/^\s+/, (ws) => ' '.repeat(ws.length))}</code>
                <span className={styles.lineNote}>{l.note}</span>
              </li>
            ))}
          </ol>
        )}
        {current.action && (
          <p className={tour.action}>
            <MousePointerClick size={iconSize('size-icon-sm')} aria-hidden className={tour.actionIcon} />
            <span>
              <span className={tour.actionLabel}>Your turn: </span>
              {current.action}
            </span>
          </p>
        )}
        <div className={tour.buttons}>
          {step > 0 && (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => go(step - 1)} data-testid="guide-back">
              Back
            </Button>
          )}
          <span className={tour.spacer} />
          {last ? (
            <Button variant="primary" onClick={() => useGuide.getState().end()} data-testid="guide-finish">
              Done
            </Button>
          ) : (
            <Button variant={waiting ? 'default' : 'primary'} icon={ArrowRight} onClick={() => go(step + 1)} data-testid="guide-next">
              {waiting ? 'Skip step' : 'Next'}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "Watch the tutorial?" in the corner, the first time something new is used. */
function GuideOffer() {
  const offer = useGuideOffer((s) => s.offer);
  if (!offer) return null;
  return createPortal(
    <div className={styles.offer} role="dialog" aria-label={`Tutorial: ${offer.title}`} data-testid="guide-offer">
      <GraduationCap aria-hidden className={styles.offerIcon} />
      <div className={styles.offerText}>
        <strong>Watch the tutorial for {offer.title}?</strong>
        <span>{offer.summary}</span>
        <div className={styles.offerButtons}>
          <Button size="sm" variant="primary" onClick={() => useGuide.getState().start(offer.build())} data-testid="guide-watch">
            Watch
          </Button>
          <Button size="sm" variant="ghost" onClick={skipOffer} data-testid="guide-skip">
            Skip
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
