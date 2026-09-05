import { ToolRunner } from "../runner.js";
import { YosysToolchainInfo } from "../parsers/types.js";

export async function getYosysToolchainInfo(runner: ToolRunner): Promise<YosysToolchainInfo> {
  const yosysRes = await runner.execute("yosys", ["-V"]);

  return {
    runtime: runner.getRuntime(),
    image: runner.getRuntime() !== "host" ? runner.getImageName() : undefined,
    yosysVersion: yosysRes.stdout.trim() || "Unknown",
    availableTargets: ["generic", "ice40", "sky130"],
  };
}
