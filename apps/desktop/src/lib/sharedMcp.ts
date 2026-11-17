import { invoke } from "@tauri-apps/api/core";
import type {
  McpActionResult,
  McpCredentials,
  McpDefinition,
  McpSessionAction,
  McpSnapshot,
  McpTestResult,
} from "../bindings";
import { toCommandError } from "./ipc";

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw toCommandError(error);
  }
}
export const sharedMcpApi = {
  snapshot: () => call<McpSnapshot>("shared_mcp_snapshot"),
  save: (expected: number, definition: McpDefinition) =>
    call<McpSnapshot>("shared_mcp_save", { expected, definition }),
  remove: (expected: number, definition: McpDefinition) =>
    call<McpSnapshot>("shared_mcp_delete", {
      expected,
      id: definition.id,
      projectId: definition.project_id,
    }),
  credentials: (expected: number, definition: McpDefinition, credentials: McpCredentials) =>
    call<McpSnapshot>("shared_mcp_credentials", {
      expected,
      id: definition.id,
      projectId: definition.project_id,
      credentials,
    }),
  import: (expected: number, document: string) =>
    call<McpSnapshot>("shared_mcp_import", { expected, document }),
  importNative: (expected: number, projectId: string | null, document: string) =>
    call<McpSnapshot>("shared_mcp_import_native", { expected, projectId, document }),
  sessionAction: (chatId: string, serverName: string, action: McpSessionAction) =>
    call<McpActionResult>("shared_mcp_session_action", { chatId, serverName, action }),
  export: () => call<string>("shared_mcp_export"),
  test: (expected: number, definition: McpDefinition, chatId?: string | null) =>
    call<McpTestResult>("shared_mcp_test", {
      expected,
      id: definition.id,
      projectId: definition.project_id,
      chatId: chatId ?? null,
    }),
};
export type SharedMcpApi = typeof sharedMcpApi;
