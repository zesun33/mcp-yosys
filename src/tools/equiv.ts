import * as path from "node:path";
import { ToolRunner } from "../runner.js";
import { extractYosysWarnings } from "../parsers/stat.js";
import { YosysEquivResult, EquivVerdict } from "../parsers/types.js";

export interface EquivOptions {
  goldSources: string[];
  gateNetlist: string;
  topModule: string;
  cwd?: string;
  timeoutMs?: number;
}

const TOP_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function classifyEquiv(exitCode: number, timedOut: boolean, output: string): { verdict: EquivVerdict; reason: string; errors: string[] } {
  const errors: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ERROR:")) errors.push(trimmed);
  }

  if (timedOut) {
    return { verdict: "INCONCLUSIVE", reason: "SAT proof timed out; rerun with a larger timeout_ms.", errors };
  }
  if (/Failed to import cell .* to SAT database/.test(output)) {
    const m = output.match(/Failed to import cell \S+ \(type (\S+)\)/);
    const cell = m ? m[1] : "sequential/latch";
    return {
      verdict: "INCONCLUSIVE",
      reason: `SAT backend cannot model ${cell} cells (latches/FFs); bounded sequential proof is out of scope for this check.`,
      errors,
    };
  }
  if (/proof did fail/i.test(output)) {
    return { verdict: "NOT_EQUIVALENT", reason: "SAT found an input assignment distinguishing gold and gate.", errors };
  }
  if (exitCode === 0 && errors.length === 0) {
    return { verdict: "EQUIVALENT", reason: "SAT proved all miter asserts; no distinguishing input exists.", errors };
  }
  return { verdict: "INCONCLUSIVE", reason: errors[0] ?? "Equivalence flow failed without a proof verdict.", errors };
}

/**
 * Proves combinational equivalence between golden RTL and a gate-level
 * netlist via `equiv_make -make_assert` + `sat -verify -prove-asserts`.
 * Reports an honest 3-state verdict: sequential/latch designs yield
 * INCONCLUSIVE (SAT import limits), never a false pass.
 */
export async function runYosysEquiv(
  runner: ToolRunner,
  options: EquivOptions
): Promise<YosysEquivResult> {
  const resolvedDir = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const { goldSources, gateNetlist, topModule } = options;

  if (goldSources.length === 0 || !gateNetlist) {
    return {
      success: false, verdict: "INCONCLUSIVE", topModule,
      provedAsserts: 0, reason: "goldSources and gateNetlist are required.",
      warnings: [], errors: ["goldSources and gateNetlist are required."],
      rawStdout: "", rawStderr: "",
    };
  }
  if (!TOP_RE.test(topModule)) {
    return {
      success: false, verdict: "INCONCLUSIVE", topModule,
      provedAsserts: 0, reason: `Invalid top module name: "${topModule}".`,
      warnings: [], errors: [`Invalid top module name: "${topModule}".`],
      rawStdout: "", rawStderr: "",
    };
  }

  const prep = "proc; opt; memory; opt; techmap; opt; flatten";
  const script = [
    ...goldSources.map((s) => `read_verilog -sv ${s}`),
    `hierarchy -check -top ${topModule}`,
    prep,
    `rename ${topModule} gold`,
    "design -stash gold",
    `read_verilog ${gateNetlist}`,
    `rename ${topModule} gate`,
    `hierarchy -check -top gate`,
    prep,
    "design -stash gate",
    "design -load gold",
    "design -import gate",
    "equiv_make -make_assert gold gate equiv",
    "hierarchy -check -top equiv",
    "sat -verify -prove-asserts equiv",
  ].join("; ");

  const execRes = await runner.execute("yosys", ["-p", script], {
    cwd: resolvedDir,
    timeoutMs: options.timeoutMs || 120000,
  });

  const combined = `${execRes.stdout}\n${execRes.stderr}`;
  const { verdict, reason, errors } = classifyEquiv(execRes.exitCode, execRes.timedOut, combined);
  if (execRes.timedOut) errors.push(`Equivalence check timed out after ${options.timeoutMs || 120000}ms.`);

  let provedAsserts = 0;
  for (const line of combined.split("\n")) {
    if (/Import proof for assert/.test(line)) provedAsserts += 1;
  }

  return {
    // success = the check completed with a definitive verdict.
    // NOT_EQUIVALENT is a successful check with a failing design.
    success: verdict !== "INCONCLUSIVE",
    topModule,
    verdict,
    provedAsserts,
    reason,
    warnings: extractYosysWarnings(execRes.stdout, execRes.stderr),
    errors,
    rawStdout: execRes.stdout,
    rawStderr: execRes.stderr,
  };
}
