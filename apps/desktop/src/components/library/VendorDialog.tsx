import { useEffect, useId, useRef, useState } from "react";
import type { PluginManagement } from "../../bindings";
import { type VendorApi, vendorApi } from "../../lib/config-vendor/api";
import type {
  VendorAction,
  VendorKind,
  VendorProvider,
  VendorRequest,
  VendorReview,
} from "../../lib/config-vendor/bindings";
import { errorMessage } from "../../lib/errors";
import type { LibraryItem } from "../../lib/library/bindings";
import { vendorTargetCopy } from "../../lib/plugins/format";
import type { TerminalTransport } from "../../lib/terminal";
import { Modal } from "../chat/Modal";
import { TerminalSheet } from "../TerminalSheet";
import "./vendor.css";

const NAMES: Readonly<Record<string, string>> = {
  claude: "Claude",
  codex: "Codex",
  pi: "Pi",
  open_code: "OpenCode",
  hermes: "Hermes",
  cursor: "Cursor",
  grok: "Grok Build",
  antigravity: "Antigravity",
};
/** A Plugin library row or step that opens this dialog already filled in. */
export interface VendorPreset {
  readonly provider: VendorProvider;
  readonly kind: VendorKind;
  readonly action: VendorAction;
  readonly target: string;
}

export function VendorDialog({
  initial,
  preset,
  onClose,
  onFinished,
  api = vendorApi,
  capabilities: suppliedCapabilities,
}: {
  readonly initial?: LibraryItem | null;
  readonly preset?: VendorPreset | null;
  readonly onClose: () => void;
  /** The reviewed command ended, with its exit code (null when it was stopped). */
  readonly onFinished?: (exitCode: number | null) => void;
  readonly api?: VendorApi;
  readonly capabilities?: readonly PluginManagement[];
}) {
  const [provider, setProvider] = useState<VendorProvider>(
    preset?.provider ??
      (initial?.provider === "pi" ? "pi" : initial?.provider === "codex" ? "codex" : "claude"),
  );
  const [kind, setKind] = useState<VendorKind>(
    preset?.kind ?? (initial?.item.kind === "package" ? "package" : "plugin"),
  );
  const [action, setAction] = useState<VendorAction>(
    preset?.action ?? (initial ? "remove" : "install"),
  );
  const [target, setTarget] = useState(preset?.target ?? initial?.item.key ?? "");
  const copy = vendorTargetCopy(provider, kind, action);
  const [busy, setBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<readonly PluginManagement[]>(
    suppliedCapabilities ?? [],
  );
  useEffect(() => {
    let current = true;
    if (suppliedCapabilities) {
      setCapabilities(suppliedCapabilities);
    } else if (api.capabilities) {
      void api
        .capabilities()
        .then((value) => {
          if (current) setCapabilities(value);
        })
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [api, suppliedCapabilities]);
  const management = capabilities.find(
    (value) => value.version === 1 && value.provider === provider,
  );
  const kinds = management?.actions ?? [];
  const offeredActions = kinds.find((value) => value.kind === kind)?.actions ?? [action];
  const [error, setError] = useState("");
  const [review, setReview] = useState<{
    value: VendorReview;
    transport: TerminalTransport;
  } | null>(null);
  const alive = useRef(false);
  const pending = useRef<string | null>(null);
  const field = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (pending.current) void api.cancel(pending.current).catch(() => {});
    };
  }, [api]);
  async function prepare() {
    setBusy(true);
    setError("");
    const request: VendorRequest = {
      provider,
      kind,
      action,
      target,
      item_revision:
        initial?.scope === "user" &&
        initial.provider === provider &&
        initial.item.kind === kind &&
        initial.item.key === target
          ? initial.revision
          : null,
    };
    try {
      const value = await api.review(request);
      if (!alive.current) {
        await api.cancel(value.token);
        return;
      }
      pending.current = value.token;
      setReview({ value, transport: api.terminal(value) });
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (review)
    return (
      <TerminalSheet
        agentId={review.value.request.provider}
        agentName={`${NAMES[review.value.request.provider]} integration`}
        purpose="setup"
        transport={review.transport}
        onClose={onClose}
        onFinished={onFinished}
        review={<VendorCommand review={review.value} />}
      />
    );
  return (
    <Modal title="Manage integrations" size="md" onClose={onClose} className="vendor-dialog">
      <p className="vendor-intro">
        {kind === "native"
          ? "Open this agent's native customization interface in a reviewed terminal."
          : "Install or change a personal integration with the agent's own reviewed command."}{" "}
        You review the exact command before it runs.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void prepare();
        }}
      >
        <div className="vendor-fields">
          <label>
            Agent
            <select
              className="g-select"
              value={provider}
              disabled={busy || kind === "native"}
              onChange={(event) => {
                const value = event.currentTarget.value as VendorProvider;
                setProvider(value);
                const next = capabilities.find((c) => c.provider === value)?.actions[0];
                if (next) {
                  setKind(next.kind);
                  setAction(next.actions[0] ?? "install");
                }
                setTarget("");
              }}
            >
              {(capabilities.length ? capabilities.map((c) => c.provider) : [provider]).map(
                (value) => (
                  <option key={value} value={value}>
                    {NAMES[value] ?? value}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Integration
            <select
              className="g-select"
              value={kind}
              disabled={busy || kind === "native"}
              onChange={(event) => {
                setKind(event.currentTarget.value as VendorKind);
                setAction(
                  kinds.find((k) => k.kind === event.currentTarget.value)?.actions[0] ?? "install",
                );
                setTarget("");
              }}
            >
              {(kinds.length && kind !== "native" ? kinds.map((k) => k.kind) : [kind]).map((k) => (
                <option value={k} key={k}>
                  {k === "native" ? "Native customization" : k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select
              className="g-select"
              value={action}
              disabled={busy || kind === "native"}
              onChange={(event) => setAction(event.currentTarget.value as VendorAction)}
            >
              {offeredActions.map((value) => (
                <option key={value} value={value}>
                  {value === "open" ? "Open" : value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="vendor-target">
          <label htmlFor={`${field}-target`}>{copy.label}</label>
          <input
            id={`${field}-target`}
            aria-describedby={`${field}-note`}
            className="g-input"
            autoComplete="off"
            spellCheck={false}
            maxLength={320}
            required
            value={target}
            disabled={busy}
            readOnly={kind === "native"}
            onChange={(event) => setTarget(event.currentTarget.value)}
            placeholder={copy.placeholder}
          />
          <small id={`${field}-note`} className="vendor-note">
            {kind === "native"
              ? (management?.native_routes.find((r) => r.id === target)?.instructions ??
                "Continue in the agent's native interactive CLI.")
              : kind === "package"
                ? "New packages need an exact npm version or a GitHub tag or commit, as in git:github.com/owner/repository@v1.2.3."
                : "Use a marketplace you trust: plugins can download and run third-party code."}{" "}
            Project configuration stays separate.
          </small>
        </div>
        {action === "remove" && kind === "marketplace" ? (
          <p className="vendor-warning">
            Removing a marketplace may also remove its plugins and their saved data. The review
            describes this before anything starts.
          </p>
        ) : null}
        {error ? (
          <p className="library-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="g-dialog-actions vendor-actions">
          <button type="button" className="g-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="g-button g-button-primary" disabled={busy || !target}>
            {busy ? "Preparing…" : "Review command"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function VendorCommand({ review }: { readonly review: VendorReview }) {
  return (
    <section className="vendor-command" aria-label="Integration command review">
      <dl>
        <dt>Action</dt>
        <dd className="vendor-command-action">
          {review.request.action} <code>{review.request.target}</code>
        </dd>
        <dt>Program</dt>
        <dd>
          <code>{review.program}</code>
        </dd>
        <dt>Arguments</dt>
        <dd>
          <ol>
            {review.arguments.map((argument) => (
              <li key={argument}>
                <code>{argument}</code>
              </li>
            ))}
          </ol>
        </dd>
        <dt>Folder</dt>
        <dd>
          <code>{review.working_directory}</code>
        </dd>
        <dt>Personal configuration</dt>
        <dd>
          <code>{review.config_directory}</code>
        </dd>
      </dl>
      <ul>
        {review.notices.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
    </section>
  );
}
