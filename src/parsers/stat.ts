import { YosysStatModule, YosysStatResult } from "./types.js";

interface RawYosysModule {
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
