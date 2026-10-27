import { useEffect, useRef, useState } from "react";
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
import type { TerminalTransport } from "../../lib/terminal";
import { Modal } from "../chat/Modal";
import { TerminalSheet } from "../TerminalSheet";
import "./vendor.css";

const NAMES = { claude: "Claude", codex: "Codex", pi: "Pi" };
export function VendorDialog({
  initial,
  onClose,
  api = vendorApi,
}: {
  readonly initial?: LibraryItem | null;
  readonly onClose: () => void;
  readonly api?: VendorApi;
}) {
  const [provider, setProvider] = useState<VendorProvider>(
    initial?.provider === "pi" ? "pi" : initial?.provider === "codex" ? "codex" : "claude",
  );
  const [kind, setKind] = useState<VendorKind>(
    initial?.item.kind === "package" ? "package" : "plugin",
  );
  const [action, setAction] = useState<VendorAction>(initial ? "remove" : "install");
  const [target, setTarget] = useState(initial?.item.key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{
    value: VendorReview;
    transport: TerminalTransport;
  } | null>(null);
  const alive = useRef(false);
  const pending = useRef<string | null>(null);
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
        review={<VendorCommand review={review.value} />}
      />
    );
  return (
    <Modal title="Manage integrations" onClose={onClose} className="vendor-dialog">
      <p className="vendor-intro">
        Install and manage personal plugins, marketplaces and Pi packages through the agent's own
        commands.
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
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.value as VendorProvider;
                setProvider(value);
                setKind(value === "pi" ? "package" : "plugin");
                setAction("install");
                setTarget("");
              }}
            >
              {Object.entries(NAMES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Integration
            <select
              className="g-select"
              value={kind}
              disabled={busy || provider === "pi"}
              onChange={(event) => {
                setKind(event.currentTarget.value as VendorKind);
                setAction("install");
                setTarget("");
              }}
            >
              {provider === "pi" ? (
                <option value="package">Package</option>
              ) : (
                <>
                  <option value="plugin">Plugin</option>
                  <option value="marketplace">Marketplace</option>
                </>
              )}
            </select>
          </label>
          <label>
            Action
            <select
              className="g-select"
              value={action}
              disabled={busy}
              onChange={(event) => setAction(event.currentTarget.value as VendorAction)}
            >
              <option value="install">{kind === "marketplace" ? "Add" : "Install"}</option>
              {provider !== "codex" || kind === "marketplace" ? (
                <option value="update">Update</option>
              ) : null}
              <option value="remove">Remove</option>
              {provider === "claude" && kind === "plugin" ? (
                <>
                  <option value="enable">Enable</option>
                  <option value="disable">Disable</option>
                </>
              ) : null}
            </select>
          </label>
        </div>
        <label className="vendor-target">
          {kind === "plugin"
            ? "Plugin and marketplace"
            : kind === "package"
              ? "Package source"
              : action === "install"
                ? "GitHub repository"
                : "Marketplace name"}
          <input
            className="g-input"
            autoComplete="off"
            spellCheck={false}
            maxLength={320}
            required
            value={target}
            disabled={busy}
            onChange={(event) => setTarget(event.currentTarget.value)}
            placeholder={
              kind === "plugin"
                ? "plugin@marketplace"
                : kind === "package"
                  ? "npm:@team/package@1.2.3"
                  : action === "install"
                    ? "owner/repository"
                    : "marketplace-name"
            }
          />
        </label>
        <p className="vendor-note">
          {kind === "package"
            ? "New packages require an exact npm version or a GitHub tag/commit: git:github.com/owner/repository@v1.2.3."
            : "Use a marketplace you trust. Plugins can download and execute third-party code."}{" "}
          Project configuration stays separate.
        </p>
        {action === "remove" && kind === "marketplace" ? (
          <p className="vendor-warning">
            Removing a marketplace may also remove its plugins and their saved data. The command
            review describes this before Start.
          </p>
        ) : null}
        {error ? (
          <p className="library-feedback" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" className="g-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="g-button g-button-primary" disabled={busy || !target}>
            {busy ? "Preparing review…" : "Review command"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function VendorCommand({ review }: { readonly review: VendorReview }) {
  return (
    <section className="vendor-command" aria-label="Integration command review">
      <h3>
        {review.request.action} · {review.request.target}
      </h3>
      <dl>
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
