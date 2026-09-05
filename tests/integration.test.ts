import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { ToolRunner } from "../src/runner.js";
import { runYosysSynthesize } from "../src/tools/synthesize.js";
import { runYosysCheckLatch } from "../src/tools/check.js";
import { runYosysHierarchy } from "../src/tools/hierarchy.js";
import { getYosysToolchainInfo } from "../src/tools/toolchain.js";

const runner = new ToolRunner();
const fixturesDir = path.resolve("fixtures");

test("Integration: yosys_toolchain_info probes container Yosys", async () => {
  const info = await getYosysToolchainInfo(runner);
  assert.equal(info.runtime, "podman");
  assert.ok(info.yosysVersion.includes("Yosys 0."), `Expected Yosys 0.x, got: ${info.yosysVersion}`);
  assert.ok(info.availableTargets.includes("generic"));
});

test("Integration: yosys_synthesize synthesizes counter.v", async () => {
  const res = await runYosysSynthesize(runner, {
    verilogSources: ["counter.v"],
    topModule: "counter",
    target: "generic",
    cwd: fixturesDir,
  });

  assert.equal(res.success, true);
  assert.equal(res.topModule, "counter");
  assert.ok(res.cellCount > 0, `Expected cellCount > 0, got ${res.cellCount}`);
  assert.ok(res.wireCount > 0, `Expected wireCount > 0, got ${res.wireCount}`);
  assert.equal(res.errors.length, 0);
});

test("Integration: yosys_check_latch detects inferred latch in latch_demo.v", async () => {
  const res = await runYosysCheckLatch(runner, {
    verilogSources: ["latch_demo.v"],
    topModule: "latch_demo",
    cwd: fixturesDir,
  });

  assert.equal(res.success, true);
  assert.equal(res.hasLatches, true);
  assert.ok(res.latches.length > 0, "Should detect at least one latch");

  const latch = res.latches.find((l) => l.variable === "q");
  assert.ok(latch, "Expected latch on variable 'q'");
  assert.equal(latch?.module, "latch_demo");
});

test("Integration: yosys_hierarchy extracts module tree in hierarchy_demo.v", async () => {
  const res = await runYosysHierarchy(runner, {
    verilogSources: ["hierarchy_demo.v"],
    topModule: "alu_top",
    cwd: fixturesDir,
  });

  assert.equal(res.success, true);
  assert.equal(res.topModule, "alu_top");
  assert.ok(res.modules.some((m) => m.name === "alu_top" && m.isTop));
  assert.ok(res.modules.some((m) => m.name === "adder"));
  assert.ok(res.modules.some((m) => m.name === "sub"));
  assert.equal(res.missingModules.length, 0);
});
