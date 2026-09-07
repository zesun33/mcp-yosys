import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVerilogNetlist,
  parseSpiceSubcktPorts,
  buildSchematicSpice,
} from "../src/tools/spice.js";

const NETLIST = `module counter(clk, rst_n, en, count);
  wire _00_;
  input clk;
  output [3:0] count;
  input en;
  input rst_n;
  sky130_fd_sc_hd__nand2_1 _07_ (
    .A(count[0]),
    .B(en),
    .Y(_04_)
  );
  sky130_fd_sc_hd__dfrtp_1 _14_ (
    .CLK(clk),
    .D(_00_),
    .Q(count[0]),
    .RESET_B(rst_n)
  );
endmodule
`;

test("parseVerilogNetlist extracts ports with bus expansion and instances", () => {
  const parsed = parseVerilogNetlist(NETLIST, "counter");
  assert.deepEqual(parsed.ports, ["clk", "count[3]", "count[2]", "count[1]", "count[0]", "en", "rst_n"]);
  assert.equal(parsed.instances.length, 2);
  assert.equal(parsed.instances[0].cell, "sky130_fd_sc_hd__nand2_1");
  assert.equal(parsed.instances[0].connections.get("A"), "count[0]");
  assert.equal(parsed.instances[1].connections.get("RESET_B"), "rst_n");
});

test("parseVerilogNetlist throws on missing top", () => {
  assert.throws(() => parseVerilogNetlist(NETLIST, "nope"), /not found/);
});

test("parseSpiceSubcktPorts handles continuations", () => {
  const text = `.subckt sky130_fd_sc_hd__nand2_1 A B VGND VNB VPB VPWR Y
X0 Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt
.ends
.subckt sky130_fd_sc_hd__dfrtp_1 CLK D RESET_B VGND
+ VNB VPB VPWR Q
.ends
`;
  const ports = parseSpiceSubcktPorts(text);
  assert.deepEqual(ports.get("sky130_fd_sc_hd__nand2_1"), ["A", "B", "VGND", "VNB", "VPB", "VPWR", "Y"]);
  assert.deepEqual(ports.get("sky130_fd_sc_hd__dfrtp_1"), ["CLK", "D", "RESET_B", "VGND", "VNB", "VPB", "VPWR", "Q"]);
});

test("buildSchematicSpice ties supplies and orders ports per PDK", () => {
  const parsed = parseVerilogNetlist(NETLIST, "counter");
  const cellPorts = parseSpiceSubcktPorts(`.subckt sky130_fd_sc_hd__nand2_1 A B VGND VNB VPB VPWR Y
.ends
.subckt sky130_fd_sc_hd__dfrtp_1 CLK D Q RESET_B VGND VNB VPB VPWR
.ends
`);
  const { text, cellCount } = buildSchematicSpice("counter", parsed, cellPorts, "/pdk/models.spice");
  assert.equal(cellCount, 2);
  assert.ok(text.includes('.include "/pdk/models.spice"'));
  assert.ok(text.includes(".subckt counter clk count[3] count[2] count[1] count[0] en rst_n"));
  assert.ok(text.includes("X_07_ count[0] en VGND VNB VPB VPWR _04_ sky130_fd_sc_hd__nand2_1"));
  assert.ok(text.includes("X_14_ clk _00_ count[0] rst_n VGND VNB VPB VPWR sky130_fd_sc_hd__dfrtp_1"));
  assert.ok(text.trimEnd().endsWith(".ends"));
});

test("buildSchematicSpice errors on unknown cells and floating signals", () => {
  const parsed = parseVerilogNetlist(NETLIST, "counter");
  assert.throws(
    () => buildSchematicSpice("counter", parsed, new Map(), "/pdk/x.spice"),
    /has no model/
  );
  const badPorts = new Map([
    ["sky130_fd_sc_hd__nand2_1", ["A", "B", "EXTRA", "Y"]],
    ["sky130_fd_sc_hd__dfrtp_1", ["CLK", "D", "Q", "RESET_B"]],
  ]);
  assert.throws(
    () => buildSchematicSpice("counter", parsed, badPorts, "/pdk/x.spice"),
    /unconnected/
  );
});
