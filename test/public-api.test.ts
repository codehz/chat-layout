import { describe, expect, test } from "bun:test";

import * as api from "../src/index";
import type {
  Context,
  FlexItemOptions,
  MultilineTextOptions,
  Node,
  TextEllipsisPosition,
  TextJustifyMode,
  TextJustifyOptions,
  TextOptions,
  TextOverflowMode,
  TextOverflowWrapMode,
  TextWhiteSpaceMode,
  UpdateListItemAnimationOptions,
} from "../src/index";

type C = CanvasRenderingContext2D;

const flexItemOptionsTypecheck: FlexItemOptions = {
  grow: 1,
  shrink: 0,
  alignSelf: "auto",
};

const nodeWithMinContentTypecheck: Node<C> = {
  measure() {
    return { width: 10, height: 10 };
  },
  measureMinContent(_ctx: Context<C>) {
    return { width: 5, height: 10 };
  },
  draw() {
    return false;
  },
  hittest() {
    return false;
  },
};

const overflowModeTypecheck: TextOverflowMode = "ellipsis";
const overflowWrapModeTypecheck: TextOverflowWrapMode = "anywhere";
const ellipsisPositionTypecheck: TextEllipsisPosition = "middle";
const whiteSpaceModeTypecheck: TextWhiteSpaceMode = "pre-wrap";

const textOptionsTypecheck: TextOptions<C> = {
  lineHeight: 20,
  font: "16px sans-serif",
  color: "#000",
  overflow: overflowModeTypecheck,
  overflowWrap: overflowWrapModeTypecheck,
  whiteSpace: whiteSpaceModeTypecheck,
  ellipsisPosition: ellipsisPositionTypecheck,
};

const multilineTextOptionsTypecheck: MultilineTextOptions<C> = {
  lineHeight: 20,
  font: "16px sans-serif",
  color: "#000",
  align: "start",
  overflow: overflowModeTypecheck,
  overflowWrap: overflowWrapModeTypecheck,
  whiteSpace: whiteSpaceModeTypecheck,
  maxLines: 2,
  justify: true,
  justifyLastLine: false,
  justifyGapThreshold: 2.0,
};

const justifyModeTypecheck: TextJustifyMode = "inter-word";
const justifyOptionsTypecheck: TextJustifyOptions = {
  justify: "inter-character",
  justifyLastLine: true,
  justifyGapThreshold: 1.5,
};

const updateAnimationOptionsTypecheck: UpdateListItemAnimationOptions = {
  duration: 180,
};

void flexItemOptionsTypecheck;
void nodeWithMinContentTypecheck;
void overflowModeTypecheck;
void overflowWrapModeTypecheck;
void ellipsisPositionTypecheck;
void whiteSpaceModeTypecheck;
void textOptionsTypecheck;
void multilineTextOptionsTypecheck;
void justifyModeTypecheck;
void justifyOptionsTypecheck;
void updateAnimationOptionsTypecheck;

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
