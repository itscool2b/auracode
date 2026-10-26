/** In-memory context fixtures for the development harness. No filesystem or native calls. */
import type { ComposerInput, ContinuationAction, PendingHandoff } from "../bindings";
import type { ChangesTransport } from "../lib/changes";
import type { Transport } from "../lib/chat/transport";
import type { ComposerTransport } from "../lib/composer";
import type { ConversationTransport } from "../lib/conversation";
import type { SearchTransport } from "../lib/search";

export function withPreviewContext<T extends Transport>(
  transport: T,
): T & {
  composer: ComposerTransport;
  changes: ChangesTransport;
  search: SearchTransport;
  conversation: ConversationTransport;
} {
  let input: ComposerInput = { text: "", attachments: [], mentions: [] };
  const attachment = {
    id: "preview-context",
    name: "interface-notes.md",
    mime: "text/plain",
    bytes: 864,
    image: false,
  };
  const composer: ComposerTransport = {
    file: async (_chat, path) => ({
      path,
      bytes: 106,
      text: 'export function Sidebar() {\n  return <nav aria-label="Projects">Your projects</nav>;\n}\n',
      truncated: false,
    }),
    draft: async () => ({ input, files: input.attachments.length ? [attachment] : [] }),
    saveDraft: async (_chat, value) => {
      input = value;
    },
    pick: async () => attachment,
    import: async () => attachment,
    paste: async () => ({
      ...attachment,
      name: "Pasted image.png",
      image: true,
      mime: "image/png",
    }),
    mentions: async (_chat, query) =>
      [
        { path: "src/components/Sidebar.tsx", directory: false },
        { path: "src/components/ChatView.tsx", directory: false },
        { path: "src/styles.css", directory: false },
      ].filter((file) => file.path.toLowerCase().includes(query.toLowerCase())),
    send: async (chat, value) =>
      transport.send(
        chat,
        [
          value.text,
          ...value.mentions.map((path) => `@${path}`),
          ...value.attachments.map(() => `[File: ${attachment.name}]`),
        ].join("\n"),
      ),
  };
  let files = [
    {
      path: "src/components/Sidebar.tsx",
      kind: "modified" as const,
      before_bytes: 128,
      after_bytes: 190,
      binary: false,
    },
    {
      path: "src/styles.css",
      kind: "modified" as const,
      before_bytes: 96,
      after_bytes: 140,
      binary: false,
    },
  ];
  let pendingRevert: string[] = [];
  const changes: ChangesTransport = {
    snapshot: async () => ({
      checkpoint: {
        id: "preview-checkpoint",
        turn_id: "preview-turn",
        created_at: 0,
        file_count: 12,
        total_bytes: 8000,
        warnings: [],
      },
      files,
      unavailable_reason: null,
    }),
    diff: async (_chat, _checkpoint, path) => ({
      path,
      before: path.endsWith("css")
        ? ".sidebar {\n  width: 240px;\n  padding: 12px;\n}"
        : "export function Sidebar() {\n  return <ChatList />;\n}",
      after: path.endsWith("css")
        ? ".sidebar {\n  width: 264px;\n  padding: 16px 12px;\n}"
        : "export function Sidebar() {\n  return (\n    <ProjectList>\n      <ChatList keepActiveVisible />\n    </ProjectList>\n  );\n}",
      binary: false,
      truncated: false,
    }),
    preview: async (_chat, checkpoint_id, paths) => {
      pendingRevert = paths;
      return {
        token: "preview-revert",
        checkpoint_id,
        files: files.filter((file) => paths.includes(file.path)),
        expires_at: Date.now() + 600_000,
        warnings: ["This is a visual fixture. No files will be changed."],
      };
    },
    revert: async () => {
      const applied = files
        .filter((file) => pendingRevert.includes(file.path))
        .map((file) => file.path);
      files = files.filter((file) => !pendingRevert.includes(file.path));
      pendingRevert = [];
      return { applied, error: null, recovery_paths: [] };
    },
  };
  const search: SearchTransport = {
    search: async (query) => ({
      chats: [
        {
          id: "preview",
          title: "Make the sidebar easier to scan",
          project: "auracode",
          snippet: "Keep the active chat visible when project groups collapse.",
          archived: false,
        },
      ].filter((chat) =>
        `${chat.title} ${chat.snippet}`.toLowerCase().includes(query.toLowerCase()),
      ),
      projects: [],
    }),
  };
  let pending: PendingHandoff | null = null;
  let action: ContinuationAction | null = null;
  const handoff =
    "Visible context from auracode\n\nProject: auracode\nGoal: Make the sidebar easier to scan.\nLast answer: Keep the active chat visible when project groups collapse.\nFiles: src/components/Sidebar.tsx, src/styles.css";
  const conversation: ConversationTransport = {
    pending: async () => pending,
    turns: async () => ({
      turns: [
        {
          turn_id: "preview-turn",
          ordinal: 1,
          agent_id: "claude",
          status: "completed",
          prompt_preview: "Make the sidebar easier to scan.",
          started_at: 0,
        },
      ],
      before_ordinal: 1,
      has_more: false,
    }),
    editable: async (_chat, turn_id) => ({
      turn_id,
      text: "Make the sidebar easier to scan.",
      has_context: true,
    }),
    preview: async (source_chat_id, value) => {
      action = value;
      return {
        token: "preview-continuation",
        source_chat_id,
        agent_id: value.type === "switch_agent" ? value.agent_id : "claude",
        creates_chat: value.type === "fork",
        resumes_native: false,
        uses_native_fork: false,
        handoff,
        prompt:
          value.type === "edit"
            ? value.text
            : value.type === "retry"
              ? "Make the sidebar easier to scan."
              : null,
        warnings: ["This is a development fixture. No real agent receives this context."],
        expires_at: Date.now() + 600_000,
      };
    },
    apply: async (chat) => {
      pending = {
        agent_id: action?.type === "switch_agent" ? action.agent_id : "claude",
        handoff,
        uses_native_fork: false,
      };
      const prompt =
        action?.type === "edit"
          ? action.text
          : action?.type === "retry"
            ? "Make the sidebar easier to scan."
            : null;
      return { chat_id: chat, prompt: prompt === null ? null : await transport.send(chat, prompt) };
    },
  };
  return Object.assign(transport, { composer, changes, search, conversation });
}
