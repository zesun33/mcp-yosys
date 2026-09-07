import test from "node:test";
import assert from "node:assert/strict";
import { parseYosysStatJson, extractYosysWarnings, parseChipArea, stripPortRedeclarations } from "../src/parsers/stat.js";

const sampleOutput = `
Yosys 0.38+92 (git sha1 84116c9a3)
Warning: Latch inferred for signal '\\latch_demo.\\q' from process '\\latch_demo.$proc$/workspace/latch_demo.v:10$1'.
{
   "creator": "Yosys 0.38+92",
   "invocation": "stat -json ",
   "modules": {
      "\\\\counter": {
         "num_wires":         10,
         "num_wire_bits":     15,
         "num_pub_wires":     4,
         "num_pub_wire_bits": 7,
         "num_memories":      0,
         "num_memory_bits":   0,
         "num_processes":     0,
         "num_cells":         8,
         "num_cells_by_type": {
            "$_AND_": 3,
            "$_DFF_P_": 4,
            "$_XOR_": 1
         }
      }
   },
   "design": {
      "num_wires":         10,
      "num_wire_bits":     15,
      "num_pub_wires":     4,
      "num_pub_wire_bits": 7,
      "num_memories":      0,
      "num_memory_bits":   0,
      "num_processes":     0,
      "num_cells":         8,
      "num_cells_by_type": {
         "$_AND_": 3,
         "$_DFF_P_": 4,
         "$_XOR_": 1
      }
   }
}
End of script.
`;

test("parseYosysStatJson extracts structured module metrics", () => {
  const parsed = parseYosysStatJson(sampleOutput);
  assert.ok(parsed, "Expected parsed stat object");
  assert.equal(parsed.creator, "Yosys 0.38+92");
  assert.equal(parsed.design.numCells, 8);
  assert.equal(parsed.design.numWires, 10);
  assert.equal(parsed.design.cellsByType["$_DFF_P_"], 4);

  assert.ok(parsed.modules["counter"], "Module \\counter should be cleaned to counter");
  assert.equal(parsed.modules["counter"].numCells, 8);
});

test("extractYosysWarnings captures latch and syntax warnings", () => {
  const warnings = extractYosysWarnings(sampleOutput, "");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("Latch inferred for signal"));
});

test("parseChipArea reads liberty stat area lines", () => {
  const out = `   Number of cells:                 24
   Chip area for module '\\counter': 123.456
   Chip area for module 'other': 10.0
`;
  assert.equal(parseChipArea(out, "counter"), 123.456);
  assert.equal(parseChipArea(out, "missing"), undefined);
  assert.equal(parseChipArea("no area here", "counter"), undefined);
});

test("stripPortRedeclarations removes OpenROAD-incompatible port dups only", () => {
  const nl = `module counter(clk, rst_n, en, count);
  wire _00_;
  input clk;
  wire clk;
  output [3:0] count;
  reg [3:0] count;
  wire [3:0] _02_;
endmodule`;
  const cleaned = stripPortRedeclarations(nl, "counter");
  assert.ok(!cleaned.includes("wire clk;"), "port wire dup must go");
  assert.ok(!cleaned.includes("reg [3:0] count;"), "port reg dup must go");
  assert.ok(cleaned.includes("input clk;"), "port direction must stay");
  assert.ok(cleaned.includes("output [3:0] count;"), "port direction must stay");
  assert.ok(cleaned.includes("wire _00_;"), "internal nets must stay");
  assert.ok(cleaned.includes("wire [3:0] _02_;"), "internal nets must stay");
  assert.equal(stripPortRedeclarations(nl, "other_module"), nl);
});
