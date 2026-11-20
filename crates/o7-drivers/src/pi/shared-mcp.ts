// Aura's session-only MCP extension. No native home or configuration file is rewritten.
interface O7PiExtension {
  registerMcpServer(name: string, config: unknown): void;
  registerCommand(
    name: string,
    command: { description: string; handler: () => Promise<void> },
  ): void;
}
export default function (pi: O7PiExtension) {
  const servers = JSON.parse(process.env.O7_SHARED_MCP ?? "{}");
  delete process.env.O7_SHARED_MCP;
  if (
    typeof pi.registerMcpServer !== "function" &&
    Object.keys(servers).some((name) => name !== "o7_project_memory")
  ) {
    throw new Error(
      "This Pi version cannot register shared MCP servers. Pi 1.0.2 or newer is required.",
    );
  }
  if (typeof pi.registerMcpServer !== "function") return;
  for (const [name, config] of Object.entries(servers)) pi.registerMcpServer(name, config);
  pi.registerCommand("o7-shared-mcp-ready", {
    description: "Aura shared MCP session registration completed",
    handler: async () => {},
  });
}
