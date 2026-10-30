import type { ExternalIds, MediaItem } from '../providers/types';
import { ID_ORDER, type SearchGroup, type SourceHit } from './model';

/**
 * Groups search hits from several servers into one card per title (docs/cross-server-search.md §2). Pure and
 * deterministic: the same hits give the same groups in the same order, whichever server answered first.
 *
 * Rules, most important first: never merge different kinds; shared external ids merge, a conflicting id in
 * the same namespace forbids a merge (also through a third title); title + exact year is a fallback only where
 * no id conflicts and exactly one group fits; episodes need their own id, or a matched series plus the same
 * season and episode number. Every copy stays in its group with its own progress and artwork.
 */

/** Case, Unicode compatibility forms and whitespace only. Punctuation and words stay: "Alien" is not "Aliens". */
export function normalizeTitle(title: string): string {
  let text = title;
  try {
    text = text.normalize('NFKC');
  } catch {
    // Some engines ship without normalisation tables; comparing unnormalised is still safe, just stricter.
  }
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

interface Building {
  kind: MediaItem['kind'];
  hits: SourceHit[];
  ids: Partial<Record<keyof ExternalIds, string>>;
  /** `title|year` for movies and series; `seriesGroup|season|episode` for episodes. */
  fallback?: string;
}

function conflicts(a: Building['ids'], b: ExternalIds | Building['ids'] | undefined): boolean {
  if (!b) {
    return false;
  }
  return ID_ORDER.some(ns => a[ns] !== undefined && b[ns] !== undefined && a[ns] !== b[ns]);
}

/** The best namespace two id sets share, as an index into ID_ORDER, or -1 when they share none. */
function sharedRank(a: Building['ids'], b: ExternalIds | undefined): number {
  if (!b) {
    return -1;
  }
  return ID_ORDER.findIndex(ns => a[ns] !== undefined && a[ns] === b[ns]);
}

function absorbIds(group: Building, ids: ExternalIds | Building['ids'] | undefined): void {
  for (const ns of ID_ORDER) {
    const value = ids?.[ns];
    if (value !== undefined && group.ids[ns] === undefined) {
      group.ids[ns] = value;
    }
  }
}

function titleFallback(item: MediaItem): string | undefined {
  if (item.year === undefined || !item.title) {
    return undefined;
  }
  return `${normalizeTitle(item.title)}|${item.year}`;
}

export interface GroupOptions {
  query: string;
  /** Source keys in preference order: the active connection first, then the rest. */
  sourceOrder: string[];
}

export function groupHits(hits: SourceHit[], options: GroupOptions): SearchGroup[] {
  const order = new Map(options.sourceOrder.map((key, index) => [key, index]));
  const sourceIndex = (hit: SourceHit) => order.get(hit.sourceKey) ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...hits].sort(
    (a, b) => sourceIndex(a) - sourceIndex(b) || a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  const groups: Building[] = [];
  const place = (hit: SourceHit, fallback: string | undefined) => {
    const ids = hit.item.externalIds;
    const sameKind = groups.filter(g => g.kind === hit.item.kind && !conflicts(g.ids, ids));
    const byId = sameKind
      .map(g => ({ g, rank: sharedRank(g.ids, ids) }))
      .filter(c => c.rank >= 0)
      .sort((a, b) => a.rank - b.rank);
    if (byId.length > 0) {
      const target = byId[0].g;
      target.hits.push(hit);
      absorbIds(target, ids);
      target.fallback = target.fallback ?? fallback;
      // A title can show two groups are one (it carries both their ids), but only if they do not disagree.
      for (const { g } of byId.slice(1)) {
        if (!conflicts(target.ids, g.ids)) {
          target.hits.push(...g.hits);
          absorbIds(target, g.ids);
          groups.splice(groups.indexOf(g), 1);
        }
      }
      return;
    }
    if (fallback !== undefined) {
      const byTitle = sameKind.filter(g => g.fallback === fallback);
      // Two candidates (two films called "Dune" from 2021 that disagree) is ambiguous: keep it on its own.
      if (byTitle.length === 1) {
        byTitle[0].hits.push(hit);
        absorbIds(byTitle[0], ids);
        return;
      }
    }
    const group: Building = { kind: hit.item.kind, hits: [hit], ids: {}, fallback };
    absorbIds(group, ids);
    groups.push(group);
  };

  // Titles first, so episodes can lean on their series having been matched.
  for (const hit of sorted) {
    if (hit.item.kind !== 'episode') {
      place(hit, titleFallback(hit.item));
    }
  }
  const seriesGroup = new Map<string, number>();
  groups.forEach((g, index) => {
    if (g.kind === 'series') {
      for (const hit of g.hits) {
        seriesGroup.set(`${hit.sourceKey}\u0000${hit.item.id}`, index);
      }
    }
  });
  for (const hit of sorted) {
    if (hit.item.kind === 'episode') {
      const { seriesId, seasonIndex, index } = hit.item;
      const parent = seriesId !== undefined ? seriesGroup.get(`${hit.sourceKey}\u0000${seriesId}`) : undefined;
      const fallback = parent !== undefined && seasonIndex !== undefined && index !== undefined ? `s${parent}|${seasonIndex}|${index}` : undefined;
      place(hit, fallback);
    }
  }

  const query = normalizeTitle(options.query);
  return groups
    .map(g => finish(g, sorted, query))
    .sort((a, b) => {
      const ta = normalizeTitle(a.display.item.title);
      const tb = normalizeTitle(b.display.item.title);
      return (
        a.bucket - b.bucket ||
        (ta < tb ? -1 : ta > tb ? 1 : 0) ||
        (a.display.item.year ?? Number.MAX_SAFE_INTEGER) - (b.display.item.year ?? Number.MAX_SAFE_INTEGER) ||
        sourceIndex(a.display) - sourceIndex(b.display) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      );
    });
}

function finish(g: Building, sorted: SourceHit[], query: string): SearchGroup {
  // Back into preference order: hits joined the group in processing order, merges can mix that up.
  const position = new Map(sorted.map((hit, index) => [hit.key, index]));
  const hits = [...g.hits].sort((a, b) => (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0));
  const display = hits[0];
  const key = hits.map(h => h.key).sort()[0];
  const title = normalizeTitle(display.item.title);
  const bucket = title === query ? 0 : query && title.startsWith(query) ? 1 : 2;
  return { key, kind: g.kind, hits, display, bucket };
}

/**
 * The group that now holds what was focused: search can merge two cards when a late server answers, and focus
 * should follow the title rather than jump to the top.
 */
export function findGroup(groups: SearchGroup[], previous: { key: string; hitKeys: string[] } | undefined): SearchGroup | undefined {
  if (!previous) {
    return undefined;
  }
  return groups.find(g => g.key === previous.key) ?? groups.find(g => g.hits.some(h => previous.hitKeys.includes(h.key)));
}

/** The copies of a group on one source: usually one, two when a server has the same title twice. */
export function hitsOn(group: SearchGroup, sourceKey: string | undefined): SourceHit[] {
  return sourceKey === undefined ? [] : group.hits.filter(h => h.sourceKey === sourceKey);
}
