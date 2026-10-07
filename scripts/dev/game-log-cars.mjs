/**
 * What BeamNG's log says about each car of a self-test batch: its lines from "self-test: spawning"
 * to the next, read for the problems the game reports, and the self-test probe's look at what came
 * apart and how it drove. Shared by game-test.mjs and game-session.mjs.
 */

const json = (line) => {
  try {
    return line ? JSON.parse(line.slice(line.indexOf('{'))) : null;
  } catch {
    return null;
  }
};

export function carsFromLog(lines) {
  const marks = lines.map((l, i) => [i, /self-test: (?:spawning|measuring) (\S+)/.exec(l)?.[1]]).filter(([, v]) => v);
  return marks.map(([at, v], k) => {
    const seg = lines.slice(at, marks[k + 1]?.[0] ?? lines.length);
    const has = (re) => seg.filter((l) => re.test(l));
    return {
      vehicle: v,
      config: /self-test: (?:spawning|measuring) \S+ (\S*)/.exec(lines[at])?.[1] ?? '',
      spawned: has(/spawning vehicle \/vehicles\//).length > 0,
      instability: has(/Instability detected/).length,
      noController: has(/No main controller found/).length > 0,
      linkErrors: has(/link target not found/).length,
      flexbodyErrors: has(/FLEXBODY ERROR/).length,
      missingMeshes: [...new Set(has(/Mesh '.*' not found/).map((l) => /Mesh '(.*)' not found/.exec(l)[1]))],
      zeroBeams: has(/zero size beam/).length,
      duplicatedBeams: has(/duplicated beam/).length,
      missingMaterials: [...new Set(has(/NO-MATERIAL/).map((l) => /mapping to: (\S+)/.exec(l)?.[1]))],
      luaErrors: has(/expressionParser|attempt to|stack traceback/).length,
      drove: json(has(/self-test: drive /)[0]),
      // What came apart, from the self-test's probe: broken beams and the most strained ones.
      diagnose: json(has(/self-test: diagnose /)[0]),
      errors: has(/\|E\|/).slice(0, 30),
    };
  });
}

const short = (p) => String(p ?? '').replace(/^forge_[a-z0-9]+_/, '');

export function printCars(cars, say) {
  for (const c of cars) say(`${c.vehicle}: ${c.spawned ? 'spawned' : 'NOT spawned'} · instability ${c.instability} · controller ${c.noController ? 'MISSING' : 'ok'} · links ${c.linkErrors} · flexbody ${c.flexbodyErrors} · meshes ${c.missingMeshes.length} · materials ${c.missingMaterials.length} · zero beams ${c.zeroBeams} · dup beams ${c.duplicatedBeams} · lua ${c.luaErrors}${c.diagnose ? ` · broken ${c.diagnose.broken}/${c.diagnose.beams}` : ''}${c.drove ? ` · drove ${Math.round((c.drove.speed ?? 0) * 3.6)} km/h in gear ${c.drove.gear}` : ''}`);
  for (const c of cars) if (c.drove && (c.drove.speed ?? 0) < 2) say(`  ${c.vehicle} didn't drive: ${JSON.stringify(c.drove)}`);
  for (const c of cars) if (c.diagnose?.broken) say(`  ${c.vehicle} broken at spawn: ${Object.entries(c.diagnose.brokenByPart ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${short(p)} ${n}`).join(', ')}`);
  for (const c of cars) if (c.instability && c.diagnose?.worst) say(`  ${c.vehicle} most strained: ${c.diagnose.worst.slice(0, 6).map(([a, b, s, part]) => `${a}-${b} ${s} (${short(part)})`).join(', ')}`);
}
