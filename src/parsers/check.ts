import { YosysCheckResult, YosysLatchInfo } from "./types.js";
import { extractYosysWarnings } from "./stat.js";

export function parseYosysCheck(
  stdout: string,
  stderr: string,
  exitCode: number
): YosysCheckResult {
  const combined = `${stdout}\n${stderr}`;
  const warnings = extractYosysWarnings(stdout, stderr);
  const latches: YosysLatchInfo[] = [];

  // Latch pattern: Latch inferred for signal `\<module>.\<signal>' from process `...:<line>$<id>'
  const latchRegex = /Latch inferred for signal [`'"]?\\?([a-zA-Z0-9_$]+)\.\\?([a-zA-Z0-9_$]+)[`'"]?(?: from process [`'"]?[^`'"]*?:(\d+)\$[^`'"]*[`'"]?)?/g;
  let match: RegExpExecArray | null;

  while ((match = latchRegex.exec(combined)) !== null) {
    const mod = match[1];
    const sig = match[2];
    const line = match[3] ? parseInt(match[3], 10) : undefined;

    latches.push({
      module: mod,
      variable: sig,
      line,
      rawMessage: match[0],
    });
  }

  // Also check for "Found latch <signal> in module <module>"
  const altLatchRegex = /Found latch [`'"]?\\?([a-zA-Z0-9_$]+)[`'"]? in module [`'"]?\\?([a-zA-Z0-9_$]+)[`'"]?/g;
  while ((match = altLatchRegex.exec(combined)) !== null) {
    const sig = match[1];
    const mod = match[2];
    if (!latches.some((l) => l.module === mod && l.variable === sig)) {
      latches.push({
        module: mod,
        variable: sig,
        rawMessage: match[0],
      });
    }
  }

  const hasCombinationalLoops =
    combined.includes("logic loop") ||
    combined.includes("combinational loop") ||
    combined.includes("Feedback loop through");

  const errors: string[] = [];
  const lines = combined.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ERROR:") || trimmed.startsWith("Error:")) {
      errors.push(trimmed);
    }
  }

  return {
    success: exitCode === 0 && errors.length === 0,
    hasLatches: latches.length > 0,
    latches,
    hasCombinationalLoops,
    warnings,
    errors,
    rawStdout: stdout,
    rawStderr: stderr,
  };
}
