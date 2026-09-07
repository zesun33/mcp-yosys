import { YosysStatModule, YosysStatResult } from "./types.js";

interface RawYosysModule {
  area?: number;
  num_wires?: number;
  num_wire_bits?: number;
  num_pub_wires?: number;
  num_pub_wire_bits?: number;
  num_memories?: number;
  num_processes?: number;
  num_cells?: number;
  num_cells_by_type?: Record<string, number>;
}

interface RawYosysJson {
  creator?: string;
  invocation?: string;
  modules?: Record<string, RawYosysModule>;
  design?: RawYosysModule;
}

function cleanModuleName(name: string): string {
  return name.startsWith("\\") ? name.slice(1) : name;
}

function transformModule(raw: RawYosysModule): YosysStatModule {
  return {
    ...(typeof raw.area === "number" ? { area: raw.area } : {}),
    numWires: raw.num_wires ?? 0,
    numWireBits: raw.num_wire_bits ?? 0,
    numPubWires: raw.num_pub_wires ?? 0,
    numPubWireBits: raw.num_pub_wire_bits ?? 0,
    numMemories: raw.num_memories ?? 0,
    numProcesses: raw.num_processes ?? 0,
    numCells: raw.num_cells ?? 0,
    cellsByType: raw.num_cells_by_type ?? {},
  };
}

export function extractYosysWarnings(stdout: string, stderr: string): string[] {
  const lines = `${stdout}\n${stderr}`.split("\n");
  const warnings: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Warning:") || trimmed.includes(" Warning: ")) {
      warnings.push(trimmed);
    }
  }

  return Array.from(new Set(warnings));
}

/**
 * Parses `Chip area for module '<name>': <area>` lines emitted by
 * `stat -liberty` (area in um^2). Returns undefined when no liberty ran.
 */
export function parseChipArea(output: string, topModule: string): number | undefined {
  const cleanTop = topModule.startsWith("\\") ? topModule.slice(1) : topModule;
  for (const line of output.split("\n")) {
    const m = line.match(/Chip area for module '\\?([^']+)':\s*([\d.]+)/);
    if (m && (m[1] === topModule || m[1] === cleanTop)) {
      const area = parseFloat(m[2]);
      if (!Number.isNaN(area)) return area;
    }
  }
  return undefined;
}

export function parseYosysStatJson(output: string): YosysStatResult | null {
  // Locate JSON block in output
  const jsonStart = output.indexOf('{\n   "creator":');
  const fallbackStart = output.indexOf('{"creator":');
  const startIdx = jsonStart !== -1 ? jsonStart : fallbackStart;

  let rawJsonStr = "";
  if (startIdx !== -1) {
    let braceCount = 0;
    let endIdx = -1;
    for (let i = startIdx; i < output.length; i++) {
      if (output[i] === "{") braceCount++;
      else if (output[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      rawJsonStr = output.slice(startIdx, endIdx + 1);
    }
  } else {
    // Attempt direct regex match for JSON
    const match = output.match(/\{[\s\S]*"creator"[\s\S]*"design"[\s\S]*\}/);
    if (match) {
      rawJsonStr = match[0];
    }
  }

  if (!rawJsonStr) {
    return null;
  }

  try {
    const parsed: RawYosysJson = JSON.parse(rawJsonStr);
    const modules: Record<string, YosysStatModule> = {};

    if (parsed.modules) {
      for (const [modName, rawMod] of Object.entries(parsed.modules)) {
        modules[cleanModuleName(modName)] = transformModule(rawMod);
      }
    }

    const design = parsed.design
      ? transformModule(parsed.design)
      : {
          area: undefined,
          numWires: 0,
          numWireBits: 0,
          numPubWires: 0,
          numPubWireBits: 0,
          numMemories: 0,
          numProcesses: 0,
          numCells: 0,
          cellsByType: {},
        };

    return {
      creator: parsed.creator || "Yosys",
      invocation: parsed.invocation || "",
      design,
      modules,
    };
  } catch {
    return null;
  }
}

/**
 * Removes port redeclarations (`wire`/`reg` lines restating module ports)
 * from Yosys `write_verilog` output. OpenROAD 2.0's Verilog frontend
 * rejects the `output [N:0] x;` + `reg [N:0] x;` form (STA-0164), which
 * silently unlinks the design and voids all downstream P&R results.
 * Internal nets are never touched: only exact port-name matches go.
 */
export function stripPortRedeclarations(netlist: string, topModule: string): string {
  const modRe = new RegExp(`module\\s+${topModule}\\s*\\(([\\s\\S]*?)\\)\\s*;`);
  const m = netlist.match(modRe);
  if (!m) return netlist;

  const ports = new Set<string>();
  let depth = 0;
  let cur = "";
  const parts: string[] = [];
  for (const ch of m[1]) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);

  for (const rawPart of parts) {
    let part = rawPart
      .replace(/^(input|output|inout)\b\s*/, "")
      .replace(/^(wire|reg|logic|signed|unsigned)\b\s*/, "")
      .replace(/^\[[^\]]+\]\s*/, "")
      .trim();
    part = part
      .replace(/^(wire|reg|logic|signed|unsigned)\b\s*/, "")
      .replace(/^\[[^\]]+\]\s*/, "")
      .trim();
    const id = part.match(/^([A-Za-z_][A-Za-z0-9_$]*)/);
    if (id) ports.add(id[1]);
  }
  if (ports.size === 0) return netlist;

  return netlist
    .split("\n")
    .filter((line) => {
      const dm = line.match(/^\s*(wire|reg)\s*(\[[^\]]+\]\s*)?([A-Za-z_][A-Za-z0-9_$]*)\s*;\s*$/);
      return !(dm && ports.has(dm[3]));
    })
    .join("\n");
}
