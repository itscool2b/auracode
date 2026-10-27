import { useEffect, useState } from "react";
import { errorMessage } from "../../lib/errors";
import { Modal } from "../chat/Modal";

export const loadNotices = () =>
  import("virtual:third-party-notices").then((module) => module.default);

export function NoticesDialog({
  onClose,
  load = loadNotices,
}: {
  readonly onClose: () => void;
  readonly load?: () => Promise<string>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load().then(
      (next) => {
        if (live) setText(next);
      },
      (failure) => {
        if (live) setError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [load]);
  return (
    <Modal title="Third-party notices" className="settings-notices" onClose={onClose}>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : text === null ? (
        <p className="settings-footnote" role="status">
          Loading notices…
        </p>
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the long notice text must scroll by keyboard.
        <section className="settings-notices-text" tabIndex={0} aria-label="Notice text">
          <pre>{text}</pre>
        </section>
      )}
    </Modal>
  );
}
