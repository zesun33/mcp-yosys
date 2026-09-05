import * as path from "node:path";
import { ToolRunner } from "../runner.js";
import { parseYosysCheck } from "../parsers/check.js";
import { YosysCheckResult } from "../parsers/types.js";

export interface CheckLatchOptions {
  verilogSources: string[];
  topModule: string;
  cwd?: string;
  timeoutMs?: number;
}

export async function runYosysCheckLatch(
  runner: ToolRunner,
  options: CheckLatchOptions
): Promise<YosysCheckResult> {
  const resolvedDir = options.cwd ? path.resolve(options.cwd) : process.cwd();

  const scriptParts: string[] = [];
  for (const src of options.verilogSources) {
    scriptParts.push(`read_verilog -sv ${src}`);
  }
  scriptParts.push(`hierarchy -check -top ${options.topModule}`);
  scriptParts.push("proc");
  scriptParts.push("check");

  const yosysScript = scriptParts.join("; ");

  const execRes = await runner.execute(
    "yosys",
    ["-p", yosysScript],
    {
      cwd: resolvedDir,
      timeoutMs: options.timeoutMs || 20000,
    }
  );

  return parseYosysCheck(execRes.stdout, execRes.stderr, execRes.exitCode);
}
