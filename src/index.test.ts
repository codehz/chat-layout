import { describe, expect, test } from "bun:test";

import * as api from "./index";

describe("root exports", () => {
  test("stable public API stays available while internal registry stays hidden", () => {
    expect(api.BaseRenderer).toBeDefined();
    expect(api.DebugRenderer).toBeDefined();
    expect(api.ChatRenderer).toBeDefined();
    expect(api.TimelineRenderer).toBeDefined();
    expect(api.ListState).toBeDefined();
    expect(api.memoRenderItem).toBeDefined();
    expect(api.memoRenderItemBy).toBeDefined();
    expect(api.Wrapper).toBeDefined();
    expect(api.PaddingBox).toBeDefined();
    expect(api.Place).toBeDefined();
    expect(api.FlexItem).toBeDefined();
    expect(api.Flex).toBeDefined();
    expect(api.Text).toBeDefined();
    expect(api.MultilineText).toBeDefined();
    expect(api.Fixed).toBeDefined();

    expect("registerNodeParent" in api).toBe(false);
    expect("unregisterNodeParent" in api).toBe(false);
    expect("getNodeParent" in api).toBe(false);
    expect("getNodeRevision" in api).toBe(false);
    expect("forEachNodeAncestor" in api).toBe(false);
  });
});
