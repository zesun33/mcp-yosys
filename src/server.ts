import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolRunner } from "./runner.js";
import { runYosysSynthesize } from "./tools/synthesize.js";
import { runYosysCheckLatch } from "./tools/check.js";
import { runYosysHierarchy } from "./tools/hierarchy.js";
import { runYosysEquiv } from "./tools/equiv.js";
import { getYosysToolchainInfo } from "./tools/toolchain.js";

export function createServer(): Server {
  const runner = new ToolRunner();

  const server = new Server(
    {
      name: "@zesun33/mcp-yosys",
      version: "0.2.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const tools: Tool[] = [
    {
      name: "yosys_synthesize",
      description:
        "Synthesizes a Verilog/SystemVerilog design using Yosys, mapping to generic gates, iCE40/Xilinx/Intel FPGAs, or Nangate45 standard cells (with area), and returns structured cell counts and warnings.",
      inputSchema: {
        type: "object",
        properties: {
          verilog_sources: {
            type: "array",
            items: { type: "string" },
            description: "List of Verilog/SystemVerilog source files.",
          },
          top_module: {
            type: "string",
            description: "Name of the top-level module to synthesize.",
          },
          target: {
            type: "string",
            enum: ["generic", "ice40", "xilinx", "intel", "sky130", "nangate45"],
            description:
              "Target architecture/library (default: 'generic'). 'sky130' needs a baked Sky130 PDK and currently errors honestly.",
          },
          liberty_file: {
            type: "string",
            description: "Optional path to Liberty (.lib) standard cell timing library.",
          },
          flatten: {
            type: "boolean",
            description: "Whether to flatten the design hierarchy during synthesis.",
          },
          output_netlist: {
            type: "string",
            description: "Optional output Verilog netlist file path.",
          },
          cwd: {
            type: "string",
            description: "Working directory where source files reside.",
          },
          timeout_ms: {
            type: "number",
            description: "Maximum synthesis timeout in milliseconds (default: 30000).",
          },
        },
        required: ["verilog_sources", "top_module"],
      },
    },
    {
      name: "yosys_check_latch",
      description:
        "Performs fast RTL elaboration and latch checking to identify inferred transparent latches, combinational loops, and multiple drivers with exact source lines.",
      inputSchema: {
        type: "object",
        properties: {
          verilog_sources: {
            type: "array",
            items: { type: "string" },
            description: "List of Verilog/SystemVerilog source files.",
          },
          top_module: {
            type: "string",
            description: "Name of the top-level module to inspect.",
          },
          cwd: {
            type: "string",
            description: "Working directory where source files reside.",
          },
          timeout_ms: {
            type: "number",
            description: "Timeout in milliseconds (default: 20000).",
          },
        },
        required: ["verilog_sources", "top_module"],
      },
    },
    {
      name: "yosys_hierarchy",
      description:
        "Inspects module hierarchy, detecting instantiated submodules and flagging missing/unresolved blackboxes.",
      inputSchema: {
        type: "object",
        properties: {
          verilog_sources: {
            type: "array",
            items: { type: "string" },
            description: "List of Verilog/SystemVerilog source files.",
          },
          top_module: {
            type: "string",
            description: "Name of the top-level module.",
          },
          cwd: {
            type: "string",
            description: "Working directory where source files reside.",
          },
          timeout_ms: {
            type: "number",
            description: "Timeout in milliseconds (default: 20000).",
          },
        },
        required: ["verilog_sources", "top_module"],
      },
    },
    {
      name: "yosys_equiv",
      description:
        "Proves combinational equivalence between golden RTL and a gate-level netlist (equiv_make + sat). Returns EQUIVALENT, NOT_EQUIVALENT, or INCONCLUSIVE (sequential/latch designs exceed the SAT backend and never fake a pass).",
      inputSchema: {
        type: "object",
        properties: {
          gold_sources: {
            type: "array",
            items: { type: "string" },
            description: "Golden RTL source files.",
          },
          gate_netlist: {
            type: "string",
            description: "Gate-level Verilog netlist to check against golden RTL.",
          },
          top_module: {
            type: "string",
            description: "Top module name (same in both designs).",
          },
          cwd: {
            type: "string",
            description: "Working directory where files reside.",
          },
          timeout_ms: {
            type: "number",
            description: "Maximum proof timeout in milliseconds (default: 120000).",
          },
        },
        required: ["gold_sources", "gate_netlist", "top_module"],
      },
    },
    {
      name: "yosys_toolchain_info",
      description:
        "Returns active container/host runtime and version information for the Yosys synthesis engine.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      if (name === "yosys_synthesize") {
        const sources = args.verilog_sources as string[];
        const top = args.top_module as string;
        const target =
          args.target as
            | "generic"
            | "ice40"
            | "xilinx"
            | "intel"
            | "sky130"
            | "nangate45"
            | undefined;
        const libertyFile = args.liberty_file as string | undefined;
        const flatten = args.flatten as boolean | undefined;
        const outputNetlist = args.output_netlist as string | undefined;
        const cwd = args.cwd as string | undefined;
        const timeoutMs = args.timeout_ms as number | undefined;

        const res = await runYosysSynthesize(runner, {
          verilogSources: sources,
          topModule: top,
          target,
          libertyFile,
          flatten,
          outputNetlist,
          cwd,
          timeoutMs,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      if (name === "yosys_check_latch") {
        const sources = args.verilog_sources as string[];
        const top = args.top_module as string;
        const cwd = args.cwd as string | undefined;
        const timeoutMs = args.timeout_ms as number | undefined;

        const res = await runYosysCheckLatch(runner, {
          verilogSources: sources,
          topModule: top,
          cwd,
          timeoutMs,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      if (name === "yosys_hierarchy") {
        const sources = args.verilog_sources as string[];
        const top = args.top_module as string;
        const cwd = args.cwd as string | undefined;
        const timeoutMs = args.timeout_ms as number | undefined;

        const res = await runYosysHierarchy(runner, {
          verilogSources: sources,
          topModule: top,
          cwd,
          timeoutMs,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      if (name === "yosys_equiv") {
        const res = await runYosysEquiv(runner, {
          goldSources: args.gold_sources as string[],
          gateNetlist: args.gate_netlist as string,
          topModule: args.top_module as string,
          cwd: args.cwd as string | undefined,
          timeoutMs: args.timeout_ms as number | undefined,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      if (name === "yosys_toolchain_info") {
        const res = await getYosysToolchainInfo(runner);
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: msg }, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}
