import { describe, expect, it } from "vitest";
import { previewBaseline } from "../core/previewData";
import { Schema } from "../core/schema";
import { correctlyMerge } from "@util/common";

describe("preview mock 搬家验证", () => {
  it("预览基底经 Schema.parse 仍是有数据 UI", () => {
    const d = Schema.parse(correctlyMerge(structuredClone(previewBaseline), {}));
    expect(d.bases).toHaveLength(2);
    expect(d.forces.girls).toHaveLength(7);
    expect(d.economy.credits).toBe(1514);
    expect(d.schema_version).toBe(2);
    expect(d.meta.world_id).toBe('xiuzhen');
    expect(d.economy.wallet).toMatchObject({ 铜钱: 2340, 银两: 15, 下品灵石: 8 });
  });
  it("真机空楼 = 归零态（无演示数据泄漏）", () => {
    const d = Schema.parse({});
    expect(d.bases).toEqual([]);
    expect(d.forces.girls).toEqual([]);
    expect(d.economy.credits).toBe(0);
  });
});
