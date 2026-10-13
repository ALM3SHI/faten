import { describe, expect, it } from "vitest";
import { MAX_STUDY_PACKS, mergeStudySnapshots, sameSnapshot } from "@/lib/study-sync";
import type { StudyPack } from "@/store/studyStore";

function pack(id: string, createdAt: string, updatedAt?: string, title = id): StudyPack {
  return { id, fileName: `${id}.pdf`, createdAt, updatedAt, title, summary: [], key_terms: [], quiz: [] };
}

describe("mergeStudySnapshots", () => {
  it("unions both sides, newest first", () => {
    const local = { packs: [pack("a", "2026-10-02")], deletedIds: [] };
    const remote = { packs: [pack("b", "2026-10-03"), pack("c", "2026-10-01")], deletedIds: [] };
    expect(mergeStudySnapshots(local, remote).packs.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps the copy edited last", () => {
    const local = { packs: [pack("a", "2026-10-01", "2026-10-05", "local")], deletedIds: [] };
    const remote = { packs: [pack("a", "2026-10-01", "2026-10-04", "remote")], deletedIds: [] };
    expect(mergeStudySnapshots(local, remote).packs[0].title).toBe("local");
    expect(mergeStudySnapshots(remote, local).packs[0].title).toBe("local");
  });

  it("drops packs deleted on either device and keeps the tombstones", () => {
    const local = { packs: [pack("a", "2026-10-01"), pack("b", "2026-10-02")], deletedIds: ["c"] };
    const remote = { packs: [pack("c", "2026-10-03"), pack("a", "2026-10-01")], deletedIds: ["b"] };
    const merged = mergeStudySnapshots(local, remote);
    expect(merged.packs.map((p) => p.id)).toEqual(["a"]);
    expect(merged.deletedIds.sort()).toEqual(["b", "c"]);
  });

  it("caps the number of packs", () => {
    const many = Array.from({ length: 8 }, (_, i) => pack(`p${i}`, `2026-10-0${i + 1}`));
    const merged = mergeStudySnapshots({ packs: many.slice(0, 4), deletedIds: [] }, { packs: many.slice(4), deletedIds: [] });
    expect(merged.packs).toHaveLength(MAX_STUDY_PACKS);
    expect(merged.packs[0].id).toBe("p7");
  });

  it("works without a remote document and ignores malformed rows", () => {
    const local = { packs: [pack("a", "2026-10-01")], deletedIds: [] };
    expect(mergeStudySnapshots(local, null).packs).toHaveLength(1);
    const remote = { packs: [null as unknown as StudyPack, pack("b", "2026-10-02")], deletedIds: [] };
    expect(mergeStudySnapshots(local, remote).packs.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("detects when the remote already matches", () => {
    const snap = { packs: [pack("a", "2026-10-01")], deletedIds: [] };
    expect(sameSnapshot(snap, { ...snap })).toBe(true);
    expect(sameSnapshot(snap, null)).toBe(false);
  });
});
