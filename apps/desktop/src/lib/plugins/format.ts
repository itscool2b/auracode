import type {
  HarnessStatus,
  ListingState,
  PluginFeature,
  VendorAction,
  VendorKind,
  VendorProvider,
} from "../../bindings";

/** Each harness state as one calm sentence. Rust decides the state; this only words it. */
export function harnessText(name: string, harness: HarnessStatus): string {
  switch (harness.state) {
    case "not_installed":
      return `${name} is not installed on this device.`;
    case "checking":
      return "Checking for updates…";
    case "up_to_date":
      return `Up to date on ${harness.version}.`;
    case "update_available":
      return `${name} ${harness.latest} is available. This device has ${harness.version}.`;
    case "unknown":
      return harness.reason;
    case "failed":
      return harness.reason;
  }
}

/** The tone of the harness dot: volt for an update (look here), red for a failed binary. */
export function harnessTone(harness: HarnessStatus): "volt" | "red" | null {
  return harness.state === "update_available" ? "volt" : harness.state === "failed" ? "red" : null;
}

export function featureLabel(feature: PluginFeature, agentId: string): string {
  switch (feature) {
    case "plugins":
      return "Plugins";
    case "marketplaces":
      // Hermes calls them taps: GitHub repositories its skills hub reads.
      return agentId === "hermes" ? "Skill sources" : "Marketplaces";
    case "packages":
      return "Packages";
    case "skills":
      return "Skills";
    case "mcp_servers":
      return "MCP servers";
    case "commands":
      return agentId === "pi"
        ? "Prompt templates"
        : agentId === "opencode"
          ? "Commands"
          : "Slash commands";
    case "subagents":
      return agentId === "opencode" ? "Agents" : "Subagents";
    case "hooks":
      return "Hooks";
  }
}

/** Where a feature's rows came from, as one line. */
export function sourceText(state: ListingState, command: string | null): string {
  switch (state.state) {
    case "live":
      return command ? `From ${command}` : "From the agent";
    case "failed":
      return `${state.reason} Showing the last available entries.`;
    case "files":
    case "unavailable":
      return state.reason;
  }
}

/** "just now", "5 minutes ago", "3 hours ago", then the date. */
export function ago(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** What the vendor dialog asks for: the field's name and an example of what each agent accepts. */
export function vendorTargetCopy(
  provider: VendorProvider | undefined,
  kind: VendorKind,
  action: VendorAction,
): { readonly label: string; readonly placeholder: string } {
  const source = "owner/repository, an https Git address or a local folder";
  if (kind === "native") return { label: "Native customization route", placeholder: "" };
  if (kind === "package")
    return { label: "Package source", placeholder: "npm:@team/package@1.2.3" };
  if (kind === "marketplace") {
    if (provider === "hermes")
      return {
        label: action === "install" ? "Skill source (GitHub repository)" : "Skill source",
        placeholder: "owner/repository",
      };
    return action === "install"
      ? { label: "Marketplace source", placeholder: source }
      : { label: "Marketplace name", placeholder: "marketplace-name" };
  }
  if (provider === "grok")
    return action === "install"
      ? { label: "Plugin source", placeholder: source }
      : { label: "Plugin name", placeholder: "plugin-name" };
  if (provider === "hermes")
    return action === "install"
      ? { label: "Plugin", placeholder: "catalog name or owner/repository" }
      : { label: "Plugin name", placeholder: "plugin-name" };
  return { label: "Plugin and marketplace", placeholder: "plugin@marketplace" };
}

/** Whether the agent's reviewed operations include adding a marketplace (or skill source). */
export function addsMarketplaces(
  management:
    | { readonly actions: readonly { kind: VendorKind; actions: readonly VendorAction[] }[] }
    | null
    | undefined,
): boolean {
  return (
    management?.actions.some(
      (action) => action.kind === "marketplace" && action.actions.includes("install"),
    ) ?? false
  );
}
