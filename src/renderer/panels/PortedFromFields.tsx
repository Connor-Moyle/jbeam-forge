import { projectStore } from '@renderer/app/stores/project';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Checkbox } from '@renderer/ui/components/Checkbox';
import { Field } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { KNOWN_GAMES, portedIssues, portedNotice, type PortedFrom } from '@shared/export/ported';

/** Set (or clear, with null) this mod's ported-from record. */
export function setPortedFrom(p: PortedFrom | null, label = 'Change ported-from details', coalesce?: string): void {
  projectStore.getState().execute({
    label,
    coalesce,
    apply: (d) => {
      if (p) d.meta.portedFrom = p;
      else delete d.meta.portedFrom;
    },
  });
}

/**
 * The declaration a ported mod needs (fork): which game, who made the
 * original, and two ticks (owns the game, mod is free). Shown in Mod
 * settings and by the importers.
 */
export function PortedFromFields({ value }: { value: PortedFrom | undefined }) {
  if (!value)
    return (
      <Button size="sm" onClick={() => setPortedFrom({ game: '', owned: false, free: false }, 'Mark as ported from a game')} data-testid="ported-add">
        This mod is ported from another game…
      </Button>
    );
  const patch = (p: Partial<PortedFrom>, key: string) => setPortedFrom({ ...value, ...p }, 'Change ported-from details', `ported-${key}`);
  const issues = portedIssues(value);
  return (
    <div data-testid="ported-fields">
      <Field label="Ported from" hint="The game the model and data came from." htmlFor="ported-game">
        <Input id="ported-game" list="ported-games" value={value.game} onChange={(e) => patch({ game: e.target.value }, 'game')} data-testid="ported-game" />
        <datalist id="ported-games">
          {KNOWN_GAMES.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Field>
      <Field label="Original by" hint="The studio or modder who made it, if you know." htmlFor="ported-credit">
        <Input id="ported-credit" value={value.credit ?? ''} onChange={(e) => patch({ credit: e.target.value || undefined }, 'credit')} />
      </Field>
      <Checkbox checked={value.owned} onChange={(owned) => patch({ owned }, 'owned')} label={`I own ${value.game.trim() || 'the game'}`} />
      <Checkbox checked={value.free} onChange={(free) => patch({ free }, 'free')} label="This mod is free: it won’t be sold or put behind a paywall" />
      {issues.length ? <Callout tone="warning">{issues[0]}</Callout> : <Callout tone="info">The mod will say: “{portedNotice(value)}”</Callout>}
      <Button size="sm" variant="ghost" onClick={() => setPortedFrom(null, 'Not ported from a game')}>
        Not ported
      </Button>
    </div>
  );
}
