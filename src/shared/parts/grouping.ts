import type { Part } from '../project/schema';
import type { TaxonomyEntry } from '../taxonomy/schema';
import type { PartNode } from './tree';

/**
 * Logical groups for the scene tree and slot menus: under each part, its
 * children are gathered by what they are (Doors, Glass, Lights, Interior,
 * Engine…), and big positional families split again into front and rear:
 *
 *   Body shell
 *     Doors
 *       Front doors
 *         Front left door ─ door card, door glass, handle…
 *         Front right door
 *       Rear doors
 *     Glass
 *     Lights
 *
 * A group is only made when it would hold at least two parts.
 */

export interface GroupInfo {
  key: string;
  label: string;
  /** Sort order among sibling groups. */
  order: number;
  category: string;
  /** Front/rear split for corner and front/rear kinds. */
  sub?: { key: string; label: string };
}

export type TreeItem =
  | { type: 'part'; node: PartNode }
  | { type: 'group'; key: string; label: string; category: string; items: TreeItem[]; total: number; count: number };

const GROUPS: { match: (e: TaxonomyEntry) => boolean; key: string; label: string }[] = [
  { match: (e) => e.category === 'Body & Structure' && e.subcategory === 'Rollcage', key: 'rollcage', label: 'Roll cage' },
  { match: (e) => e.category === 'Body & Structure', key: 'structure', label: 'Structure' },
  { match: (e) => e.subcategory === 'Doors', key: 'doors', label: 'Doors' },
  { match: (e) => e.subcategory === 'Fenders', key: 'fenders', label: 'Fenders & quarters' },
  { match: (e) => e.category === 'Panels', key: 'panels', label: 'Body panels' },
  { match: (e) => e.subcategory === 'Bumpers', key: 'bumpers', label: 'Bumpers' },
  { match: (e) => e.category === 'Bumpers & Aero', key: 'aero', label: 'Aero' },
  { match: (e) => e.category === 'Glass', key: 'glass', label: 'Glass' },
  { match: (e) => e.category === 'Lights', key: 'lights', label: 'Lights' },
  { match: (e) => e.category === 'Exterior Trim', key: 'trim', label: 'Exterior trim' },
  { match: (e) => e.category === 'Interior', key: 'interior', label: 'Interior' },
  { match: (e) => e.subcategory === 'Engine', key: 'engine', label: 'Engine' },
  { match: (e) => e.subcategory === 'Exhaust', key: 'exhaust', label: 'Exhaust' },
  { match: (e) => e.subcategory === 'Cooling', key: 'cooling', label: 'Cooling' },
  { match: (e) => e.subcategory === 'Fuel', key: 'fuel', label: 'Fuel' },
  { match: (e) => e.subcategory === 'Electrical', key: 'electrical', label: 'Electrical' },
  { match: (e) => e.subcategory === 'Driveline', key: 'driveline', label: 'Driveline' },
  { match: (e) => e.subcategory === 'Suspension', key: 'suspension', label: 'Suspension' },
  { match: (e) => e.subcategory === 'Steering', key: 'steering', label: 'Steering' },
  { match: (e) => e.subcategory === 'Wheels', key: 'wheels', label: 'Wheels' },
  { match: (e) => e.subcategory === 'Brakes', key: 'brakes', label: 'Brakes' },
  { match: () => true, key: 'misc', label: 'Other' },
];

export function groupInfo(entry: TaxonomyEntry | undefined, part: Part): GroupInfo | null {
  if (!entry) return null;
  const order = GROUPS.findIndex((g) => g.match(entry));
  const g = GROUPS[order]!;
  let sub: GroupInfo['sub'];
  if ((entry.positionAxis === 'corner' || entry.positionAxis === 'fr') && part.position) {
    const front = part.position.startsWith('F');
    sub = { key: front ? 'front' : 'rear', label: `${front ? 'Front' : 'Rear'} ${g.label.toLowerCase()}` };
  }
  return { key: g.key, label: g.label, order, category: entry.category, sub };
}

const countParts = (items: TreeItem[]): number => items.reduce((n, i) => n + (i.type === 'part' ? 1 : i.count), 0);
const totalMeshes = (items: TreeItem[]): number => items.reduce((n, i) => n + (i.type === 'part' ? i.node.total : i.total), 0);

/** Group a part's children (already sorted) into logical groups; `parentKey` keeps group keys unique. */
export function groupItems(nodes: readonly PartNode[], infoOf: (p: Part) => GroupInfo | null, parentKey: string): TreeItem[] {
  const buckets = new Map<string, { info: GroupInfo; nodes: PartNode[] }>();
  const loose: PartNode[] = [];
  for (const n of nodes) {
    const info = infoOf(n.part);
    if (!info) {
      loose.push(n);
      continue;
    }
    const b = buckets.get(info.key);
    if (b) b.nodes.push(n);
    else buckets.set(info.key, { info, nodes: [n] });
  }
  const out: { order: number; item: TreeItem }[] = [];
  for (const { info, nodes: members } of buckets.values()) {
    if (members.length < 2) {
      for (const m of members) out.push({ order: info.order, item: { type: 'part', node: m } });
      continue;
    }
    // Split into front/rear when both halves exist and the family is big enough to need it.
    const subKeys = new Set(members.map((m) => infoOf(m.part)?.sub?.key).filter(Boolean));
    let items: TreeItem[];
    if (members.length >= 4 && subKeys.size >= 2) {
      const subs = new Map<string, { label: string; nodes: PartNode[] }>();
      const rest: PartNode[] = [];
      for (const m of members) {
        const s = infoOf(m.part)?.sub;
        if (!s) {
          rest.push(m);
          continue;
        }
        const e = subs.get(s.key);
        if (e) e.nodes.push(m);
        else subs.set(s.key, { label: s.label, nodes: [m] });
      }
      items = rest.map((node) => ({ type: 'part' as const, node }));
      for (const key of ['front', 'rear']) {
        const s = subs.get(key);
        if (!s) continue;
        const subItems: TreeItem[] = s.nodes.map((node) => ({ type: 'part', node }));
        if (s.nodes.length < 2) items.push(...subItems);
        else items.push({ type: 'group', key: `${parentKey}|${info.key}|${key}`, label: s.label, category: info.category, items: subItems, total: totalMeshes(subItems), count: countParts(subItems) });
      }
    } else items = members.map((node) => ({ type: 'part', node }));
    out.push({ order: info.order, item: { type: 'group', key: `${parentKey}|${info.key}`, label: info.label, category: info.category, items, total: totalMeshes(items), count: countParts(items) } });
  }
  out.sort((a, b) => a.order - b.order);
  return [...loose.map((node) => ({ type: 'part' as const, node })), ...out.map((o) => o.item)];
}
