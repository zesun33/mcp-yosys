import * as path from "node:path";
import { ToolRunner } from "../runner.js";
import { parseYosysStatJson, extractYosysWarnings } from "../parsers/stat.js";
import { YosysHierarchyResult, YosysHierarchyModule } from "../parsers/types.js";

export interface HierarchyOptions {
  verilogSources: string[];
  topModule: string;
  cwd?: string;
  timeoutMs?: number;
}

export async function runYosysHierarchy(
  runner: ToolRunner,
  options: HierarchyOptions
): Promise<YosysHierarchyResult> {
  const resolvedDir = options.cwd ? path.resolve(options.cwd) : process.cwd();

  const scriptParts: string[] = [];
  for (const src of options.verilogSources) {
    scriptParts.push(`read_verilog -sv ${src}`);
  }
  scriptParts.push(`hierarchy -check -top ${options.topModule}`);
  scriptParts.push("stat -json");

  const yosysScript = scriptParts.join("; ");

  const execRes = await runner.execute(
    "yosys",
    ["-p", yosysScript],
    {
      cwd: resolvedDir,
      timeoutMs: options.timeoutMs || 20000,
    }
  );

  const warnings = extractYosysWarnings(execRes.stdout, execRes.stderr);
  const statResult = parseYosysStatJson(execRes.stdout);

  const missingModules: string[] = [];
  const combined = `${execRes.stdout}\n${execRes.stderr}`;
  const missingMatch = combined.match(/referenced module `([^`]+)` is not defined/g);
  if (missingMatch) {
    for (const m of missingMatch) {
      const name = m.replace("referenced module `", "").replace("` is not defined", "");
      if (!missingModules.includes(name)) {
        missingModules.push(name);
      }
    }
  }

  const modules: YosysHierarchyModule[] = [];
  if (statResult) {
    for (const modName of Object.keys(statResult.modules)) {
      const isTop = modName === options.topModule;
      // Extract submodules instantiated by checking cell types that are user modules
      const submodules: string[] = [];
      const cells = statResult.modules[modName].cellsByType;
      for (const cellType of Object.keys(cells)) {
        if (!cellType.startsWith("$") && Object.keys(statResult.modules).includes(cellType)) {
          submodules.push(cellType);
        }
      }
      modules.push({
        name: modName,
        isTop,
        submodules,
      });
    }
  }

  return {
    success: execRes.exitCode === 0 && missingModules.length === 0,
    topModule: options.topModule,
    modules,
    missingModules,
    warnings,
    rawStdout: execRes.stdout,
    rawStderr: execRes.stderr,
  };
}
