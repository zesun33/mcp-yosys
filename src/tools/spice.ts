import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ToolRunner } from "../runner.js";
import { defaultSky130Liberty } from "./synthesize.js";

export type SpiceTarget = "sky130";

export interface WriteSpiceOptions {
  netlistFile: string;
  topModule: string;
  libertyFile?: string;
  outputSpice?: string;
  cwd?: string;
}

export interface WriteSpiceResult {
  success: boolean;
  topModule: string;
  spiceFile?: string;
  cellCount: number;
  warnings: string[];
  errors: string[];
}

// Supply pins auto-tied when the synth netlist leaves them unconnected
// (Yosys omits undriven power pins). Anything else missing is an error.
const SUPPLY_PINS = new Set(["VPWR", "VGND", "VPB", "VNB"]);

export interface ParsedInstance {
  cell: string;
  name: string;
  connections: Map<string, string>;
}

export interface ParsedModule {
  ports: string[];
  instances: ParsedInstance[];
}

function expandBus(name: string, range: string | undefined): string[] {
  if (!range) return [name];
  const m = range.match(/\[\s*(\d+)\s*:\s*(\d+)\s*\]/);
  if (!m) return [name];
  const hi = parseInt(m[1], 10);
  const lo = parseInt(m[2], 10);
  const out: string[] = [];
  if (hi >= lo) {
    for (let i = hi; i >= lo; i--) out.push(`${name}[${i}]`);
  } else {
    for (let i = hi; i <= lo; i++) out.push(`${name}[${i}]`);
  }
  return out;
}

/** Parses a Yosys write_verilog-style module: port decls + cell instances. */
export function parseVerilogNetlist(text: string, topModule: string): ParsedModule {
  const modRe = new RegExp(`module\\s+${topModule}\\s*\\(([\\s\\S]*?)\\)\\s*;([\\s\\S]*?)endmodule`, "");
  const modMatch = text.match(modRe);
  if (!modMatch) {
    throw new Error(`Top module '${topModule}' not found in netlist.`);
  }
  const body = modMatch[2];
  const ports: string[] = [];
  // Re-scan with ranges: match decl kind + optional range + names.
  const fullDeclRe = /(input|output|inout)\s*(\[\s*\d+\s*:\s*\d+\s*\])?\s*([^;]+);/g;
  let dm: RegExpExecArray | null;
  while ((dm = fullDeclRe.exec(body)) !== null) {
    const range = dm[2];
    for (const raw of dm[3].split(",")) {
      const name = raw.trim();
      if (!name || name.startsWith(".")) continue;
      ports.push(...expandBus(name, range));
    }
  }
  const instances: ParsedInstance[] = [];
  const instRe = /(\S+)\s+(\S+)\s*\(([\s\S]*?)\)\s*;/g;
  let im: RegExpExecArray | null;
  while ((im = instRe.exec(body)) !== null) {
    const cell = im[1];
    const name = im[2].replace(/\\$/, "");
    if (cell === "module" || !im[3].includes(".")) continue;
    const connections = new Map<string, string>();
    const connRe = /\.(\w+)\s*\(\s*([^,)]*?)\s*\)/g;
    let cm: RegExpExecArray | null;
    while ((cm = connRe.exec(im[3])) !== null) {
      connections.set(cm[1], cm[2]);
    }
    if (connections.size === 0) continue;
    instances.push({ cell, name, connections });
  }
  return { ports, instances };
}

/** Parses `.subckt CELL ports...` (with `+` continuations) from a SPICE file. */
export function parseSpiceSubcktPorts(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const logical = text.replace(/\r?\n[ \t]*\+/g, " ");
  const re = /^[ \t]*\.subckt\s+(\S+)\s+([^\n*]*)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logical)) !== null) {
    out.set(m[1], m[2].trim().split(/\s+/).filter(Boolean));
  }
  return out;
}

export function buildSchematicSpice(
  topModule: string,
  parsed: ParsedModule,
  cellPorts: Map<string, string[]>,
  includePath: string
): { text: string; cellCount: number } {
  const lines: string[] = [
    `* Hierarchical SPICE schematic generated from synthesis netlist for LVS.`,
    `* Cell port order follows the PDK models; unconnected supply pins tie to global supplies.`,
    `.include "${includePath}"`,
    `.subckt ${topModule} ${parsed.ports.join(" ")}`,
  ];
  let n = 0;
  for (const inst of parsed.instances) {
    const order = cellPorts.get(inst.cell);
    if (!order) {
      throw new Error(`Cell '${inst.cell}' (instance ${inst.name}) has no model in the PDK SPICE file.`);
    }
    const nets: string[] = [];
    for (const port of order) {
      const net = inst.connections.get(port);
      if (net !== undefined && net !== "") {
        if (/^[01]'[bhd]/i.test(net) || /^(1'b[01]|1'h[0-9a-f])$/i.test(net)) {
          throw new Error(`Instance ${inst.name} ties port ${port} to constant '${net}'; tie cells are not supported.`);
        }
        nets.push(net);
      } else if (SUPPLY_PINS.has(port.toUpperCase())) {
        nets.push(port.toUpperCase());
      } else {
        throw new Error(`Instance ${inst.name} leaves signal port ${port} unconnected; cannot emit SPICE.`);
      }
    }
    lines.push(`X${inst.name} ${nets.join(" ")} ${inst.cell}`);
    n++;
  }
  lines.push(".ends");
  return { text: lines.join("\n") + "\n", cellCount: n };
}

function pdkSpiceFromLiberty(libertyPath: string): string | undefined {
  // .../sky130A/libs.ref/sky130_fd_sc_hd/lib/<corner>.lib ->
  // .../sky130A/libs.ref/sky130_fd_sc_hd/spice/sky130_fd_sc_hd.spice
  const m = libertyPath.replace(/\\/g, "/").match(/^(.*libs\.ref\/sky130_fd_sc_hd)\/lib\/[^/]+\.lib$/);
  return m ? `${m[1]}/spice/sky130_fd_sc_hd.spice` : undefined;
}

export async function runYosysWriteSpice(
  runner: ToolRunner,
  options: WriteSpiceOptions
): Promise<WriteSpiceResult> {
  const fail = (errors: string[]): WriteSpiceResult => ({
    success: false, topModule: options.topModule, cellCount: 0, warnings: [], errors,
  });
  if (!options.netlistFile) return fail(["No netlist file specified."]);

  // PDK cell models are required for hierarchical LVS expansion; only the
  // Sky130 PDK ships SPICE models today.
  const liberty = options.libertyFile || defaultSky130Liberty(runner);
  if (!liberty) {
    return fail(["SPICE schematic export needs the Sky130 PDK cell models: set MCP_YOSYS_PDK_ROOT to a volare sky130 cache (the <sha> version dir)."]);
  }
  const modelLib = pdkSpiceFromLiberty(liberty);
  if (!modelLib) {
    return fail([`SPICE schematic export needs Sky130 PDK cell models; liberty '${liberty}' is not a sky130_fd_sc_hd library.`]);
  }
  // The .include path must resolve where Netgen runs. Default PDK flow:
  // container path /pdk/... (Netgen runs containerized with /pdk mounted);
  // host runtime uses the host path. Explicit relative liberty files pass
  // through untouched (resolved against the tool cwd, same as liberty).
  const pdkDir = runner.getPdkDir();
  const toHostPath = (p: string) =>
    p.startsWith("/pdk/") && pdkDir ? path.join(pdkDir, p.slice("/pdk/".length)) : p;
  const includePath = runner.getRuntime() === "host" ? toHostPath(modelLib) : modelLib;
  // Parsing always reads through the host filesystem.
  const hostModels = toHostPath(modelLib);

  const base = path.resolve(options.cwd || process.cwd());
  const out = options.outputSpice || `${options.topModule}_schematic.spice`;
  try {
    const netlist = await fs.readFile(path.join(base, options.netlistFile), "utf-8");
    const models = await fs.readFile(hostModels, "utf-8").catch(() => "");
    if (!models) {
      return fail([`Could not read PDK SPICE models at '${hostModels}'; is MCP_YOSYS_PDK_ROOT set to the volare <sha> version dir?`]);
    }
    const parsed = parseVerilogNetlist(netlist, options.topModule);
    if (parsed.instances.length === 0) {
      return fail([`No cell instances found for top '${options.topModule}'; expected Yosys write_verilog output.`]);
    }
    const cellPorts = parseSpiceSubcktPorts(models);
    const { text, cellCount } = buildSchematicSpice(options.topModule, parsed, cellPorts, includePath);
    await fs.writeFile(path.join(base, out), text, "utf-8");
    return { success: true, topModule: options.topModule, spiceFile: out, cellCount, warnings: [], errors: [] };
  } catch (e) {
    return fail([e instanceof Error ? e.message : String(e)]);
  }
}
