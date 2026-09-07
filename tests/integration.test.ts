import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ToolRunner } from "../src/runner.js";
import { runYosysSynthesize } from "../src/tools/synthesize.js";
import { runYosysCheckLatch } from "../src/tools/check.js";
import { runYosysHierarchy } from "../src/tools/hierarchy.js";
import { runYosysEquiv } from "../src/tools/equiv.js";
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

test("Integration: yosys_synthesize maps counter.v to Nangate45 with area", async () => {
  const res = await runYosysSynthesize(runner, {
    verilogSources: ["counter.v"],
    topModule: "counter",
    target: "nangate45",
    outputNetlist: "counter_nangate_tmp.v",
    cwd: fixturesDir,
  });

  assert.equal(res.success, true, `Nangate synth failed: ${res.errors.join("; ")}`);
  assert.ok(res.cellCount > 0);
  assert.ok(
    typeof res.areaUm2 === "number" && res.areaUm2 > 0,
    `Expected areaUm2 > 0, got ${res.areaUm2}`
  );
});

test("Integration: yosys_synthesize maps hierarchy_demo.v to xilinx and intel", async () => {
  for (const target of ["xilinx", "intel"] as const) {
    const res = await runYosysSynthesize(runner, {
      verilogSources: ["hierarchy_demo.v"],
      topModule: "alu_top",
      target,
      cwd: fixturesDir,
    });
    assert.equal(res.success, true, `${target} synth failed: ${res.errors.join("; ")}`);
    assert.ok(res.cellCount > 0, `${target}: expected cells`);
  }
});

test("Integration: yosys_synthesize rejects sky130 without a visible PDK", async () => {
  const savedYosys = process.env.MCP_YOSYS_PDK_ROOT;
  const savedShared = process.env.PDK_ROOT;
  delete process.env.MCP_YOSYS_PDK_ROOT;
  delete process.env.PDK_ROOT;
  try {
    const res = await runYosysSynthesize(new ToolRunner(), {
      verilogSources: ["counter.v"],
      topModule: "counter",
      target: "sky130",
      cwd: fixturesDir,
    });

    assert.equal(res.success, false);
    assert.ok(res.errors.some((e) => e.includes("Sky130")), `Expected Sky130 guidance, got: ${res.errors.join("; ")}`);
  } finally {
    if (savedYosys !== undefined) process.env.MCP_YOSYS_PDK_ROOT = savedYosys;
    if (savedShared !== undefined) process.env.PDK_ROOT = savedShared;
  }
});

const PDK_ROOT = process.env.MCP_YOSYS_PDK_ROOT || process.env.PDK_ROOT || "";
const pdkIt = PDK_ROOT ? test : test.skip;

pdkIt("Integration (PDK): yosys_synthesize maps counter to sky130_fd_sc_hd cells", async () => {
  const res = await runYosysSynthesize(new ToolRunner(), {
    verilogSources: ["counter.v"],
    topModule: "counter",
    target: "sky130",
    outputNetlist: "counter_sky130_tmp.v",
    cwd: fixturesDir,
  });
  try {
    assert.equal(res.success, true, `sky130 synth failed: ${res.errors.join("; ")}`);
    assert.ok(res.cellCount > 0, "sky130: expected cells");
    assert.ok(
      Object.keys(res.cellsByType).some((c) => c.startsWith("sky130_fd_sc_hd__")),
      `sky130: expected sky130_fd_sc_hd__ cells, got: ${Object.keys(res.cellsByType).join(", ")}`
    );
    assert.ok(res.areaUm2 !== undefined && res.areaUm2 > 0, "sky130: expected areaUm2");
  } finally {
    await fs.rm(path.join(fixturesDir, "counter_sky130_tmp.v"), { force: true });
  }
});

test("Integration: yosys_equiv proves alu_top against its own netlist", async () => {
  const synth = await runYosysSynthesize(runner, {
    verilogSources: ["hierarchy_demo.v"],
    topModule: "alu_top",
    target: "generic",
    outputNetlist: "alu_top_gate_tmp.v",
    cwd: fixturesDir,
  });
  assert.equal(synth.success, true);

  const res = await runYosysEquiv(runner, {
    goldSources: ["hierarchy_demo.v"],
    gateNetlist: "alu_top_gate_tmp.v",
    topModule: "alu_top",
    cwd: fixturesDir,
  });

  assert.equal(res.verdict, "EQUIVALENT", `Expected EQUIVALENT: ${res.reason} ${res.errors.join("; ")}`);
  assert.equal(res.success, true);
  assert.ok(res.provedAsserts > 0, "Expected proven asserts");
});

test("Integration: yosys_equiv catches a swapped-mux mutant", async () => {
  const res = await runYosysEquiv(runner, {
    goldSources: ["hierarchy_demo.v"],
    gateNetlist: "hierarchy_mutant.v",
    topModule: "alu_top",
    cwd: fixturesDir,
  });

  assert.equal(res.verdict, "NOT_EQUIVALENT");
  assert.equal(res.success, true);
});

test("Integration: yosys_equiv is inconclusive on sequential counter", async () => {
  const synth = await runYosysSynthesize(runner, {
    verilogSources: ["counter.v"],
    topModule: "counter",
    target: "generic",
    outputNetlist: "counter_gate_tmp.v",
    cwd: fixturesDir,
  });
  assert.equal(synth.success, true);

  const res = await runYosysEquiv(runner, {
    goldSources: ["counter.v"],
    gateNetlist: "counter_gate_tmp.v",
    topModule: "counter",
    cwd: fixturesDir,
  });

  assert.equal(res.verdict, "INCONCLUSIVE");
  assert.equal(res.success, false);
});
