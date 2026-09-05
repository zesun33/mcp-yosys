import test from "node:test";
import assert from "node:assert/strict";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/server.js";

test("MCP server registers required Yosys tools", async () => {
  const server = createServer();
  const handler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);

  assert.ok(handler, "ListTools handler should be registered");

  const response = await handler({ method: "tools/list" });
  assert.ok(response.tools, "Tools list must be returned");

  const toolNames = response.tools.map((t: any) => t.name);

  assert.ok(toolNames.includes("yosys_synthesize"), "Should expose yosys_synthesize");
  assert.ok(toolNames.includes("yosys_check_latch"), "Should expose yosys_check_latch");
  assert.ok(toolNames.includes("yosys_hierarchy"), "Should expose yosys_hierarchy");
  assert.ok(toolNames.includes("yosys_toolchain_info"), "Should expose yosys_toolchain_info");

  for (const tool of response.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.description && tool.description.length > 10);
  }
});
