import { describe, expect, it } from "vitest";
import { layers, layoutDiagram, wrapLabel } from "@/lib/diagram-layout";
import type { Diagram } from "@/lib/tutor";

const node = (id: string, label = id, shape: "box" | "db" | "decision" = "box") => ({ id, label, shape });
const edge = (from: string, to: string, label = "", reply = false) => ({ from, to, label, reply });

const flow: Diagram = {
  type: "flow",
  direction: "lr",
  nodes: [node("app", "Client App"), node("pg", "PostgreSQL"), node("disk", "Tables & WAL", "db")],
  edges: [edge("app", "pg", "SQL"), edge("pg", "disk")],
};

describe("diagram layout", () => {
  it("puts each step one layer after the chain that leads to it", () => {
    const { rank, back } = layers(flow.nodes, flow.edges);
    expect([rank.get("app"), rank.get("pg"), rank.get("disk")]).toEqual([0, 1, 2]);
    expect(back.size).toBe(0);
  });

  it("reads right to left: the first step is on the right", () => {
    const l = layoutDiagram(flow);
    const x = (id: string) => l.boxes.find((b) => b.node.id === id)!.x;
    expect(x("app")).toBeGreaterThan(x("pg"));
    expect(x("pg")).toBeGreaterThan(x("disk"));
    expect(l.arrows).toHaveLength(2);
    // everything fits inside the drawing
    for (const b of l.boxes) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(l.width);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(l.height);
    }
  });

  it("draws a loop back as an arc instead of breaking the layers", () => {
    const loop: Diagram = { ...flow, edges: [...flow.edges, edge("disk", "app", "retry")] };
    const { back } = layers(loop.nodes, loop.edges);
    expect(back.size).toBe(1);
    const l = layoutDiagram(loop);
    expect(l.arrows.filter((a) => a.back)).toHaveLength(1);
  });

  it("stacks a top-to-bottom flow", () => {
    const l = layoutDiagram({ ...flow, direction: "tb" });
    const y = (id: string) => l.boxes.find((b) => b.node.id === id)!.y;
    expect(y("app")).toBeLessThan(y("pg"));
    expect(y("pg")).toBeLessThan(y("disk"));
  });

  it("lays a sequence out as columns with lifelines, messages in order", () => {
    const seq: Diagram = {
      type: "sequence",
      direction: "lr",
      nodes: [node("b", "Browser"), node("api", "API"), node("db", "Database")],
      edges: [edge("b", "api", "HTTPS"), edge("api", "db", "SQL"), edge("db", "api", "rows", true), edge("api", "b", "JSON", true)],
    };
    const l = layoutDiagram(seq);
    expect(l.lifelines).toHaveLength(3);
    const xs = l.boxes.map((b) => b.x);
    expect(xs[0]).toBeGreaterThan(xs[1]); // first actor on the right
    const ys = l.arrows.map((a) => a.labelY);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys); // top to bottom
  });

  it("places a cycle around an ellipse and connects every step", () => {
    const cyc: Diagram = {
      type: "cycle",
      direction: "lr",
      nodes: [node("a", "اكتب"), node("b", "نفّذ"), node("c", "راجع")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    };
    const l = layoutDiagram(cyc);
    expect(l.arrows).toHaveLength(3);
    expect(l.boxes[0].y).toBeLessThan(l.boxes[1].y); // starts at the top
  });

  it("wraps long labels into at most two lines", () => {
    expect(wrapLabel("Client App")).toEqual(["Client App"]);
    const lines = wrapLabel("قاعدة بيانات علائقية تخزن الجداول والفهارس وسجل الكتابة المسبقة للتعافي");
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.length <= 22)).toBe(true);
  });
});
