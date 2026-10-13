/**
 * Merge rules for study packs kept on several devices.
 *
 * Firestore holds users/{uid}/study/packs = { packs, deletedIds, updatedAt }.
 * Each device keeps its own copy (studyStore). On sign-in the two are merged:
 *   • a pack deleted anywhere (its id in either tombstone list) is dropped;
 *   • the same pack on both sides keeps the copy edited last (updatedAt);
 *   • the newest MAX_STUDY_PACKS packs survive.
 */

import type { StudyPack } from "@/store/studyStore";

export const MAX_STUDY_PACKS = 5;
/** Tombstones remembered so a delete on one device reaches the others. */
export const MAX_DELETED_IDS = 50;

export interface StudySnapshot {
  packs: StudyPack[];
  deletedIds: string[];
}

function editedAt(p: StudyPack): string {
  return p.updatedAt ?? p.createdAt;
}

/** Newest first, capped. */
export function sortAndCap(packs: StudyPack[]): StudyPack[] {
  return [...packs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_STUDY_PACKS);
}

export function capTombstones(ids: string[]): string[] {
  return [...new Set(ids)].slice(-MAX_DELETED_IDS);
}

export function mergeStudySnapshots(local: StudySnapshot, remote: StudySnapshot | null): StudySnapshot {
  if (!remote) return { packs: sortAndCap(local.packs), deletedIds: capTombstones(local.deletedIds) };
  const deleted = new Set([...remote.deletedIds, ...local.deletedIds]);
  const byId = new Map<string, StudyPack>();
  for (const p of [...remote.packs, ...local.packs]) {
    if (!p || typeof p.id !== "string" || deleted.has(p.id)) continue;
    const seen = byId.get(p.id);
    if (!seen || editedAt(p) > editedAt(seen)) byId.set(p.id, p);
  }
  return {
    packs: sortAndCap([...byId.values()]),
    deletedIds: capTombstones([...remote.deletedIds, ...local.deletedIds]),
  };
}

/** Cheap structural equality for "does the remote need this merge?". */
export function sameSnapshot(a: StudySnapshot, b: StudySnapshot | null): boolean {
  return !!b && JSON.stringify(a) === JSON.stringify({ packs: b.packs, deletedIds: b.deletedIds });
}
