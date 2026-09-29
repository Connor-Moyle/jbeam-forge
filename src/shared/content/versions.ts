/** Version numbers as GitHub tags carry them ("v0.12.0", "0.13.0-beta.2"), ordered like semver. Shared by the updater and the Downloads window. */

/** Numeric parts of a version ("v0.12.0-beta.2" → [0,12,0] + pre "beta.2"). */
export function parseVersion(v: string): { nums: number[]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)], pre: m[4] ?? '' };
}

/** Semver order: <0 when a is older than b. Unparseable versions sort oldest. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! - y.nums[i]!;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // a release is newer than its pre-releases
  if (!y.pre) return -1;
  const pa = x.pre.split('.');
  const pb = y.pre.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const s = pa[i];
    const t = pb[i];
    if (s === undefined) return -1;
    if (t === undefined) return 1;
    const ns = /^\d+$/.test(s) ? Number(s) : NaN;
    const nt = /^\d+$/.test(t) ? Number(t) : NaN;
    if (!Number.isNaN(ns) && !Number.isNaN(nt) && ns !== nt) return ns - nt;
    if (s !== t) return s < t ? -1 : 1;
  }
  return 0;
}

/** Is `a` a newer version than `b`? */
export function isNewer(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}
