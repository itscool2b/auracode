import { useEffect, useRef } from "react";
import { AGENT_NAMES } from "../agents";
import { useReducedMotion } from "../motion";

const agentList = `${AGENT_NAMES.slice(0, -1).join(", ")} and ${AGENT_NAMES.at(-1) ?? ""}`;

const QUESTIONS: readonly { question: string; answer: string }[] = [
  {
    question: "Is auracode free?",
    answer:
      "Yes. The Local desktop app is free and there is no paid tier. Cloud sync is an invite-only private preview.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. The app works without an account or a network connection. An account only adds encrypted sync between your machines, and accounts are invite-only for now.",
  },
  {
    question: "Which agents does it run?",
    answer: `${agentList}, plus any agent that speaks the Agent Client Protocol. Each one runs through its own harness.`,
  },
  {
    question: "Does auracode see my API keys or logins?",
    answer:
      "No. auracode never reads, stores or proxies agent credentials. Each agent signs in through its own flow and keeps its own keys.",
  },
  {
    question: "Does it work offline?",
    answer:
      "Yes. Projects, chats and sessions are stored on your computer and the app needs no connection. Your agents may still need one for their own services.",
  },
  {
    question: "How does cloud sync work?",
    answer:
      "Sync is optional and end-to-end encrypted: content is encrypted on your device before upload, and the service stores ciphertext. Accounts are invite-only during the private preview.",
  },
  {
    question: "Which systems are supported?",
    answer:
      "Windows 10 or newer on x64 and ARM64, and macOS 13.3 or newer on Apple silicon and Intel.",
  },
];

const OPEN = 300;
const SLIDE = 270;
const QUINT = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * X Money's FAQ: one row open at a time, opening over 300ms, and the open row's tinted well slides
 * from the old row to the new one in about 270ms. Built on <details>, so every answer opens without
 * JavaScript; the script only adds the motion and keeps one row open.
 */
export function Faq() {
  const list = useRef<HTMLDivElement>(null);
  const well = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = list.current;
    const shade = well.current;
    if (!root || !shade) return;
    const items = Array.from(root.querySelectorAll<HTMLDetailsElement>("details.faq-item"));
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      if (ms <= 0) return fn();
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const summary = (item: HTMLDetailsElement) => item.querySelector("summary");
    const inner = (item: HTMLDetailsElement) => item.querySelector<HTMLElement>(".faq-answer");
    const gap = () => Number.parseFloat(getComputedStyle(root).rowGap) || 0;
    const current = () => items.find((item) => item.open && item.dataset.state !== "closing");

    /** Where `target` will sit once it is the only open row. */
    const settled = (target: HTMLDetailsElement) => {
      let top = 0;
      for (const item of items) {
        if (item === target) break;
        top += (summary(item)?.offsetHeight ?? 0) + gap();
      }
      const height = (summary(target)?.offsetHeight ?? 0) + (inner(target)?.scrollHeight ?? 0);
      return { top, height };
    };

    const place = (
      target: HTMLDetailsElement | undefined,
      from?: { top: number; height: number },
    ) => {
      if (!target) {
        shade.style.opacity = "0";
        return;
      }
      const to = settled(target);
      const showing = shade.style.opacity === "1";
      shade.style.top = `${to.top}px`;
      shade.style.height = `${to.height}px`;
      shade.style.opacity = "1";
      if (from && showing && !reduced && to.height > 0) {
        shade.animate(
          [
            {
              transform: `translateY(${from.top - to.top}px) scaleY(${from.height / to.height})`,
            },
            { transform: "none" },
          ],
          { duration: SLIDE, easing: QUINT },
        );
      }
    };

    const open = (item: HTMLDetailsElement) => {
      item.dataset.state = "opening";
      item.open = true;
      void item.offsetHeight;
      requestAnimationFrame(() => {
        if (item.dataset.state === "opening") item.dataset.state = "open";
      });
    };
    const close = (item: HTMLDetailsElement) => {
      item.dataset.state = "closing";
      later(
        () => {
          if (item.dataset.state !== "closing") return;
          item.open = false;
          delete item.dataset.state;
        },
        reduced ? 0 : OPEN,
      );
    };

    const toggle = (item: HTMLDetailsElement) => {
      const was = current();
      const from = was ? { top: was.offsetTop, height: was.offsetHeight } : undefined;
      if (was === item) {
        close(item);
        place(undefined);
        return;
      }
      if (was) close(was);
      open(item);
      place(item, from);
    };

    const handlers = items.map((item) => {
      const onClick = (event: Event) => {
        event.preventDefault();
        toggle(item);
      };
      // Find in page can open a row natively; keep one open and the well on it.
      const onToggle = () => {
        if (!item.open || item.dataset.state) return;
        for (const other of items) if (other !== item && other.open) close(other);
        item.dataset.state = "open";
        place(item);
      };
      summary(item)?.addEventListener("click", onClick);
      item.addEventListener("toggle", onToggle);
      return () => {
        summary(item)?.removeEventListener("click", onClick);
        item.removeEventListener("toggle", onToggle);
      };
    });

    for (const item of items) if (item.open) item.dataset.state = "open";
    place(current());
    root.dataset.well = "";
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const shown = current();
            if (shown && shown.dataset.state === "open") place(shown);
          });
    resize?.observe(root);

    return () => {
      for (const off of handlers) off();
      for (const id of timers) window.clearTimeout(id);
      resize?.disconnect();
      delete root.dataset.well;
    };
  }, [reduced]);

  return (
    <section className="section faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <div className="faq-head" data-reveal="">
          <h2 id="faq-title" className="title">
            Questions, answered. <span>Before you install.</span>
          </h2>
          <a className="g-button g-button-outline g-button-36" href="/privacy">
            Privacy notice
          </a>
        </div>
        <div className="faq-list" ref={list}>
          <span className="faq-well" ref={well} aria-hidden="true" />
          {QUESTIONS.map((item, i) => (
            <details className="faq-item" key={item.question} open={i === 0}>
              <summary>
                <span className="faq-question">{item.question}</span>
                <span className="faq-icon" aria-hidden="true">
                  <span />
                  <span />
                </span>
              </summary>
              <div className="faq-body">
                <div className="faq-answer">
                  <p>{item.answer}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
