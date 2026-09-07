import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ToolRunner } from "../runner.js";
import { parseYosysStatJson, extractYosysWarnings, parseChipArea, stripPortRedeclarations } from "../parsers/stat.js";
import { YosysSynthesizeResult } from "../parsers/types.js";

export type YosysTarget = "generic" | "ice40" | "xilinx" | "intel" | "sky130" | "nangate45";

export interface SynthesizeOptions {
  verilogSources: string[];
  topModule: string;
  target?: YosysTarget;
  libertyFile?: string;
  flatten?: boolean;
  outputNetlist?: string;
  cwd?: string;
  timeoutMs?: number;
}

export async function runYosysSynthesize(
  runner: ToolRunner,
  options: SynthesizeOptions
): Promise<YosysSynthesizeResult> {
  const target = options.target || "generic";
  const resolvedDir = options.cwd ? path.resolve(options.cwd) : process.cwd();

  // Build Yosys synthesis script
  const scriptParts: string[] = [];

  // 1. Read sources
  for (const src of options.verilogSources) {
    scriptParts.push(`read_verilog -sv ${src}`);
  }

  // 2. Hierarchy check
  scriptParts.push(`hierarchy -check -top ${options.topModule}`);

  // 3. Flatten if requested
  if (options.flatten) {
    scriptParts.push("flatten");
  }

  // 4. Synthesis pass based on target
  let activeLiberty = options.libertyFile;
  if (target === "ice40") {
    scriptParts.push(`synth_ice40 -top ${options.topModule}`);
  } else if (target === "xilinx") {
    scriptParts.push(`synth_xilinx -top ${options.topModule}`);
  } else if (target === "intel") {
    scriptParts.push(`synth_intel -top ${options.topModule}`);
  } else if (target === "sky130") {
    // Yosys 0.38 has no synth_sky130 and the image bakes no Sky130 PDK yet
    // (see volare); fail honestly instead of emitting a doomed script.
    return {
      success: false,
      topModule: options.topModule,
      target,
      cellCount: 0,
      cellsByType: {},
      wireCount: 0,
      warnings: [],
      errors: [
        "Target 'sky130' needs a Sky130 PDK baked into the image, which is not installed yet. Use 'nangate45' or 'generic', or install the PDK with volare (see eda-docker-images).",
      ],
      rawStdout: "",
      rawStderr: "",
    };
  } else if (target === "nangate45") {
    if (!activeLiberty) {
      activeLiberty = "/opt/platforms/nangate45/NangateOpenCellLibrary_typical.lib";
    }
    scriptParts.push(`synth -top ${options.topModule}`);
    scriptParts.push(`dfflibmap -liberty ${activeLiberty}`);
    scriptParts.push(`abc -liberty ${activeLiberty}`);
    scriptParts.push("clean");
  } else if (activeLiberty) {
    scriptParts.push(`synth -top ${options.topModule}`);
    scriptParts.push(`dfflibmap -liberty ${activeLiberty}`);
    scriptParts.push(`abc -liberty ${activeLiberty}`);
    scriptParts.push("clean");
  } else {
    // Generic logic synthesis
    scriptParts.push(`synth -top ${options.topModule}`);
  }

  // 5. Stat JSON
  if (activeLiberty) {
    scriptParts.push(`stat -liberty ${activeLiberty} -json`);
  } else {
    scriptParts.push("stat -json");
  }

  // 6. Write netlist if requested
  if (options.outputNetlist) {
    scriptParts.push(`write_verilog -noattr ${options.outputNetlist}`);
  }

  const yosysScript = scriptParts.join("; ");

  const execRes = await runner.execute(
    "yosys",
    ["-p", yosysScript],
    {
      cwd: resolvedDir,
      timeoutMs: options.timeoutMs || 30000,
    }
  );

  const warnings = extractYosysWarnings(execRes.stdout, execRes.stderr);
  const statResult = parseYosysStatJson(execRes.stdout);

  const errors: string[] = [];
  if (execRes.timedOut) {
    errors.push(`Synthesis timed out after ${options.timeoutMs || 30000}ms.`);
  }

  const combined = `${execRes.stdout}\n${execRes.stderr}`;
  for (const line of combined.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ERROR:") || trimmed.startsWith("Error:")) {
      errors.push(trimmed);
    }
  }

  const isSuccess = execRes.exitCode === 0 && errors.length === 0;

  // OpenROAD 2.0 rejects `output/reg` port redeclarations (STA-0164),
  // silently unlinking the design. Strip them from emitted netlists.
  if (isSuccess && options.outputNetlist) {
    try {
      const netPath = path.join(resolvedDir, options.outputNetlist);
      const text = await fs.readFile(netPath, "utf-8");
      const cleaned = stripPortRedeclarations(text, options.topModule);
      if (cleaned !== text) {
        await fs.writeFile(netPath, cleaned, "utf-8");
        warnings.push("Removed OpenROAD-incompatible port redeclarations from netlist.");
      }
    } catch {
      // Netlist post-processing is best-effort; synthesis already succeeded.
    }
  }

  const topModuleClean = options.topModule;
  const targetModule = statResult?.modules[topModuleClean] || statResult?.design;

  const areaUm2 = activeLiberty
    ? (targetModule?.area ?? parseChipArea(execRes.stdout, options.topModule))
    : undefined;

  return {
    success: isSuccess,
    topModule: options.topModule,
    target,
    cellCount: targetModule?.numCells ?? 0,
    cellsByType: targetModule?.cellsByType ?? {},
    wireCount: targetModule?.numWires ?? 0,
    ...(areaUm2 !== undefined ? { areaUm2 } : {}),
    warnings,
    errors,
    netlistPath: options.outputNetlist ? path.join(resolvedDir, options.outputNetlist) : undefined,
    rawStdout: execRes.stdout,
    rawStderr: execRes.stderr,
  };
}
