import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { beamngControl, controlLabel, controlWarning } from '@shared/lua/keys';
import { Button } from '@renderer/ui/components/Button';
import styles from './Scripts.module.css';

/**
 * A script key: click, press the key you want. Stored as BeamNG's control name
 * ("lctrl m"), shown as "Ctrl + M". Esc cancels, Backspace clears.
 */
export function KeyCapture({ value, onChange, label }: { value: string; onChange: (control: string) => void; label: string }) {
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setListening(false);
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        onChange('');
        return setListening(false);
      }
      const control = beamngControl(e);
      if (!control) return; // a modifier on its own: wait for the key
      onChange(control);
      setListening(false);
    };
    // Capture: before the app's own shortcuts (Ctrl+Z…) see it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, onChange]);
  const warning = controlWarning(value);
  return (
    <div className={styles.keyCapture}>
      <Button ref={ref} size="sm" variant={listening ? 'primary' : 'default'} icon={Keyboard} onClick={() => setListening(!listening)} onBlur={() => setListening(false)} aria-label={`${label} key`} data-testid="script-key">
        {listening ? 'Press a key… (Esc cancels)' : value ? controlLabel(value) : 'No key: click to set'}
      </Button>
      {value && !listening && <code className={styles.keyCode}>{value}</code>}
      {warning && !listening && <p className={styles.keyWarning}>{warning}</p>}
    </div>
  );
}
