import test from "node:test";
import assert from "node:assert/strict";
import { parseYosysCheck } from "../src/parsers/check.js";

test("parseYosysCheck detects inferred latches with module and variable", () => {
  const stdout = `
1. Executing CHECK pass (checking for obvious problems).
Warning: Latch inferred for signal '\\latch_demo.\\q' from process '\\latch_demo.$proc$/workspace/latch_demo.v:10$1'.
Checking module latch_demo...
Warning: Found and reported 1 problems.
`;
  const res = parseYosysCheck(stdout, "", 0);

  assert.equal(res.success, true);
  assert.equal(res.hasLatches, true);
  assert.equal(res.latches.length, 1);
  assert.equal(res.latches[0].module, "latch_demo");
  assert.equal(res.latches[0].variable, "q");
  assert.equal(res.latches[0].line, 10);
});

test("parseYosysCheck detects combinational logic loops", () => {
  const stdout = `
Warning: found logic loop in module \\bad_combo:
  \\bad_combo.\\a -> \\bad_combo.\\b -> \\bad_combo.\\a
`;
  const res = parseYosysCheck(stdout, "", 0);

  assert.equal(res.hasCombinationalLoops, true);
  assert.equal(res.hasLatches, false);
});

test("parseYosysCheck handles clean design with 0 problems", () => {
  const stdout = `
Checking module counter...
Found and reported 0 problems.
`;
  const res = parseYosysCheck(stdout, "", 0);

  assert.equal(res.success, true);
  assert.equal(res.hasLatches, false);
  assert.equal(res.hasCombinationalLoops, false);
  assert.equal(res.latches.length, 0);
});
