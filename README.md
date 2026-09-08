# @zesun33/mcp-yosys

> Model Context Protocol (MCP) server for open-source RTL synthesis, cell statistics, and latch triage via [Yosys](https://yosyshq.net/yosys/).

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/zesun33/mcp-yosys/actions/workflows/ci.yml/badge.svg)](https://github.com/zesun33/mcp-yosys/actions/workflows/ci.yml)
[![Protocol: MCP](https://img.shields.io/badge/protocol-MCP_stdio-blueviolet)](https://modelcontextprotocol.io)
[![Runtime: Rootless Podman](https://img.shields.io/badge/runtime-rootless_podman-brightgreen)](#execution-runtime)

`mcp-yosys` equips AI coding agents and IDEs (**Cursor**, **Windsurf**, **GitHub Copilot / OpenAI Codex**, **Claude Code**, **Google Antigravity**, **OpenCode**, **Cline**) with structured tools to synthesize Verilog/SystemVerilog designs, inspect cell hierarchies, and triage synthesis hazards (such as unintended transparent latches and combinational loops) before committing code to ASIC or FPGA physical design flows.

---

## ⚡ Quick Tour: See It in Action

### Why AI Agents Need `mcp-yosys`
| Without `mcp-yosys` (Raw Yosys CLI) | With `mcp-yosys` (Structured MCP) |
| :--- | :--- |
| Dumps 500+ lines of techmap & ABC logs into context | Structured JSON with **`< 100 tokens`** of clean metrics |
| Inferred latches buried in intermediate RTLIL logs | Pinpointed latch alerts: `"variable": "q", "line": 8` |
| Agent blindly guesses gate count and area footprint | Direct **cell breakdown** (`$_AND_`, `$_DFF_P_`, `$_XOR_`) |
| Unresolved blackboxes silently fail downstream P&R | Explicit **`missingModules`** validation |
| Requires manual installation of Yosys, ABC, and libs | **Zero host configuration** (runs via isolated rootless Podman) |

### Real Agent Scenarios in 60 Seconds

#### 1. Probing the Environment (Zero-Config Verification)
```json
// Tool Call: yosys_toolchain_info
{
  "runtime": "podman",
  "image": "ghcr.io/zesun33/asic",
  "yosysVersion": "Yosys 0.38+92 (git sha1 84116c9a3)",
  "availableTargets": ["generic", "ice40", "xilinx", "intel", "sky130", "nangate45"]
}
```

#### 2. Instant Latch Detection & Triage (130ms)
```json
// Tool Call: yosys_check_latch {"verilog_sources": ["latch_demo.v"], "top_module": "latch_demo"}
{
  "success": true,
  "hasLatches": true,
  "latches": [
    {
      "module": "latch_demo",
      "variable": "q",
      "line": 8,
      "rawMessage": "Latch inferred for signal `\\latch_demo.\\q' from process `\\latch_demo.$proc$latch_demo.v:8$1'"
    }
  ],
  "hasCombinationalLoops": false,
  "warnings": [
    "Latch inferred for signal `\\latch_demo.\\q' from process `\\latch_demo.$proc$latch_demo.v:8$1': $auto$proc_dlatch.cc:433:proc_dlatch$15"
  ]
}
```

#### 3. Gate-Level Synthesis & Cell Accounting (220ms)
```json
// Tool Call: yosys_synthesize {"verilog_sources": ["counter.v"], "top_module": "counter", "target": "generic"}
{
  "success": true,
  "topModule": "counter",
  "target": "generic",
  "cellCount": 10,
  "cellsByType": {
    "$_AND_": 2,
    "$_DFFE_PN0P_": 4,
    "$_NOT_": 1,
    "$_XOR_": 3
  },
  "wireCount": 8,
  "warnings": [],
  "errors": []
}
```

#### 4. Design Hierarchy & Blackbox Inspection (140ms)
```json
// Tool Call: yosys_hierarchy {"verilog_sources": ["hierarchy_demo.v"], "top_module": "alu_top"}
{
  "success": true,
  "topModule": "alu_top",
  "modules": [
    { "name": "alu_top", "isTop": true, "submodules": ["adder", "sub"] },
    { "name": "adder", "isTop": false, "submodules": [] },
    { "name": "sub", "isTop": false, "submodules": [] }
  ],
  "missingModules": []
}
```

---

## Tools Exposed

| Tool | Parameters | Engine | Description |
| :--- | :--- | :--- | :--- |
| `yosys_synthesize` | `verilog_sources: string[]`, `top_module: string`, `target?: "generic" \| "ice40" \| "xilinx" \| "intel" \| "sky130" \| "nangate45"`, `flatten?: boolean`, `output_netlist?: string`, `cwd?: string`, `timeout_ms?: number` | `yosys synth` | Synthesizes RTL design to generic gates, iCE40/Xilinx/Intel FPGAs, Nangate45 standard cells, or Sky130 (`sky130_fd_sc_hd`, with `areaUm2`), returning structured cell counts. `sky130` needs a host-side volare PDK (`MCP_YOSYS_PDK_ROOT`, tt_100C_1v80 corner) and errors honestly without one. |
| `yosys_write_spice` | `netlist_file: string`, `top_module: string`, `liberty_file?: string`, `output_spice?: string`, `cwd?: string` | PDK models + netlist parser | Converts a synthesized gate-level netlist to a hierarchical SPICE schematic for Netgen LVS: `.include`s the PDK cell models, orders cell pins per the models, ties unconnected supply pins (`VPWR/VGND/VPB/VNB`) to global supplies. Needs the Sky130 PDK; errors honestly otherwise. |
| `yosys_check_latch` | `verilog_sources: string[]`, `top_module: string`, `cwd?: string`, `timeout_ms?: number` | `yosys check` | Fast RTL elaboration pass to detect inferred transparent latches, combinational loops, and multiple drivers with source line numbers. |
| `yosys_equiv` | `gold_sources: string[]`, `gate_netlist: string`, `top_module: string`, `cwd?: string`, `timeout_ms?: number` | `equiv_make -make_assert` + `sat -verify` | Proves combinational equivalence (EQUIVALENT / NOT_EQUIVALENT / INCONCLUSIVE; sequential and latch designs report INCONCLUSIVE, never a false pass). |
| `yosys_hierarchy` | `verilog_sources: string[]`, `top_module: string`, `cwd?: string`, `timeout_ms?: number` | `yosys hierarchy` | Analyzes module instantiation tree and verifies that no submodules or blackboxes are missing. |
| `yosys_toolchain_info` | *none* | Probe | Returns active container/host runtime and Yosys synthesis engine version. |

---

## Execution Runtime

`mcp-yosys` runs inside the [`zesun33/asic`](https://github.com/zesun33/eda-docker-images) rootless Podman image so tools are identical on any Linux host.

**Public install (recommended — anyone can pull):**
```bash
podman pull ghcr.io/zesun33/asic:latest
export MCP_YOSYS_IMAGE=ghcr.io/zesun33/asic
```

`ghcr.io/zesun33/asic` is the default (anyone can pull). Local builds still work as `localhost/zesun33/asic` via `MCP_YOSYS_IMAGE`.

- Container mount: `-v <workspace>:/workspace:Z -w /workspace`
- Podman storage option: `--storage-opt overlay.ignore_chown_errors=true`

To force host binaries instead of container execution:
```bash
export MCP_YOSYS_RUNTIME=host
```

Other useful overrides:
```bash
export MCP_YOSYS_IMAGE=ghcr.io/zesun33/fpga    # FPGA image instead of ASIC
```


---

## Universal Client & AI IDE Setup

Because `mcp-yosys` implements the standard [Model Context Protocol (MCP)](https://modelcontextprotocol.io), it connects seamlessly to any MCP-compliant AI IDE or agent interface:

| Environment | Supported Tools | Setup Location |
| :--- | :--- | :--- |
| **AI IDEs** | Cursor, Windsurf, Google Antigravity, Zed | `.cursor/mcp.json` or `.windsurf/mcp.json` |
| **Extensions** | GitHub Copilot / OpenAI Codex, Cline, Roo Code | VS Code MCP extension settings |
| **CLI Agents** | Claude Code, OpenCode, Goose, Antigravity CLI (`agy`) | Global MCP configuration or CLI flags |
| **Desktop** | Claude Desktop | `claude_desktop_config.json` |

### 1. Cursor / Windsurf / Antigravity IDE
Add to your project's `.cursor/mcp.json` or `.windsurf/mcp.json`:
```json
{
  "mcpServers": {
    "yosys": {
      "command": "node",
      "args": ["/path/to/personal-projects/mcp-yosys/dist/index.js"]
    }
  }
}
```

### 2. VS Code (GitHub Copilot / OpenAI Codex / Cline)
Add to your VS Code MCP settings or user configuration:
```json
{
  "mcpServers": {
    "yosys": {
      "command": "node",
      "args": ["/path/to/personal-projects/mcp-yosys/dist/index.js"]
    }
  }
}
```

### 3. Claude Desktop & Claude Code
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "yosys": {
      "command": "node",
      "args": ["/path/to/personal-projects/mcp-yosys/dist/index.js"]
    }
  }
}
```

---

## Verification & Testing

Run the full 6-gate verification suite:
```bash
# Full verification (with Podman container execution)
./scripts/verify.sh

# Fast / CI verification (headless environments)
./scripts/verify.sh --quick
```

Run specific test tiers:
```bash
npm run test:unit       # Fast unit tests (parsers & contract)
npm test                # Full test suite (including live container synthesis)
```
