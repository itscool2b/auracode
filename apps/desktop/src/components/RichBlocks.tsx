import { CopyButton } from "@auracode/ui/graphite";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { errorMessage } from "../lib/errors";
import { highlightCode } from "../lib/highlight";
import "./rich-blocks.css";

/**
 * Code, math and diagrams in answers (owner's plan, 4 November 2026, missing features A). Agent
 * text still never becomes HTML: highlight.js's spans are rebuilt as elements, KaTeX builds its
 * own DOM nodes, and Mermaid's SVG (strict security, text labels only) is parsed as XML. KaTeX
 * and Mermaid load the first time an answer needs them.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
};

/**
 * highlight.js's HTML as elements. It writes only `<span class="hljs-…">`, `</span>` and escaped
 * text, so anything else (which it never writes) stays text.
 */
export function highlightNodes(html: string): ReactNode[] {
  const root: ReactNode[] = [];
  const stack: { className: string; children: ReactNode[] }[] = [];
  const target = () => stack[stack.length - 1]?.children ?? root;
  let key = 0;
  for (const match of html.matchAll(/<span class="([\w\s-]+)">|<\/span>|[^<]+|</g)) {
    const [token, className] = match;
    if (className !== undefined) stack.push({ className, children: [] });
    else if (token === "</span>") {
      const span = stack.pop();
      if (span)
        target().push(
          <span key={key++} className={span.className}>
            {span.children}
          </span>,
        );
    } else target().push(token.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITIES[e] ?? e));
  }
  while (stack.length > 0) {
    const span = stack.pop();
    if (span) target().push(...span.children);
  }
  return root;
}

/** A fenced code block, coloured when its language is known. */
export function CodeBlock({
  lang,
  code,
  closed,
}: {
  readonly lang: string;
  readonly code: string;
  readonly closed: boolean;
}) {
  const colored = useMemo(() => {
    const html = highlightCode(code, lang);
    return html === null ? null : highlightNodes(html);
  }, [code, lang]);
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{lang || "Code"}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre data-test-block="code" aria-busy={!closed}>
        <code className={colored ? "hljs" : undefined}>{colored ?? code}</code>
      </pre>
    </div>
  );
}

type Katex = typeof import("katex").default;
let katex: Promise<Katex> | null = null;
function loadKatex(): Promise<Katex> {
  katex ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => module.default,
  );
  return katex;
}

/** TeX as math, set by KaTeX; the TeX itself shows until KaTeX has loaded, and if it cannot. */
export function MathView({ tex, display }: { readonly tex: string; readonly display: boolean }) {
  const block = useRef<HTMLDivElement>(null);
  const inline = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState<Katex | null>(null);
  useEffect(() => {
    let live = true;
    loadKatex().then(
      (module) => {
        if (live) setReady(() => module);
      },
      () => {
        // The TeX stays as text.
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const target = display ? block.current : inline.current;
    if (!ready || !target) return;
    try {
      ready.render(tex, target, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        output: "htmlAndMathml",
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [ready, tex, display]);
  const source = display ? `$$${tex}$$` : `$${tex}$`;
  if (failed || !ready)
    return display ? (
      <pre className="math-source" data-test-block="math">
        {source}
      </pre>
    ) : (
      <code className="math-source">{source}</code>
    );
  return display ? (
    <div ref={block} className="math-block" data-test-block="math" title={tex} />
  ) : (
    <span ref={inline} className="math-inline" title={tex} />
  );
}

/** The document's appearance and theme, so a diagram redraws in the new colours. */
function subscribeTheme(change: () => void): () => void {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-palette"],
  });
  return () => observer.disconnect();
}
function themeKey(): string {
  const root = document.documentElement;
  return `${root.dataset.theme ?? ""}/${root.dataset.palette ?? ""}`;
}

type Mermaid = typeof import("mermaid").default;
let mermaid: Promise<Mermaid> | null = null;
let diagrams = 0;
function loadMermaid(): Promise<Mermaid> {
  mermaid ??= import("mermaid").then((module) => module.default);
  return mermaid;
}

/** A Mermaid diagram in the theme's colours, with its code a click away. */
export function MermaidBlock({
  code,
  closed,
}: {
  readonly code: string;
  readonly closed: boolean;
}) {
  const theme = useSyncExternalStore(subscribeTheme, themeKey, () => "");
  const [view, setView] = useState<"diagram" | "code">("diagram");
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void theme;
    if (!closed) return;
    let live = true;
    loadMermaid()
      .then(async (engine) => {
        const style = getComputedStyle(document.documentElement);
        const color = (name: string) => style.getPropertyValue(name).trim();
        engine.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // dagre ships with Mermaid; its ELK layout is left out (lib/elkStub.ts).
          layout: "dagre",
          suppressErrorRendering: true,
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          theme: "base",
          fontFamily: color("--g-sans"),
          themeVariables: {
            background: color("--g-surface-1"),
            primaryColor: color("--g-surface-2"),
            primaryTextColor: color("--g-fg-1"),
            primaryBorderColor: color("--g-line-strong"),
            secondaryColor: color("--g-surface-3"),
            tertiaryColor: color("--g-surface-1"),
            lineColor: color("--g-fg-3"),
            textColor: color("--g-fg-1"),
            fontSize: "13px",
          },
        });
        const { svg: markup } = await engine.render(`aura-diagram-${++diagrams}`, code);
        const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
        const element = parsed.documentElement;
        if (element.nodeName !== "svg" || parsed.querySelector("parsererror"))
          throw new Error("Mermaid returned something other than a drawing.");
        if (live) {
          setSvg(document.importNode(element, true) as unknown as SVGSVGElement);
          setProblem(null);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setSvg(null);
          setProblem(errorMessage(error, "Mermaid could not draw this diagram."));
        }
      });
    return () => {
      live = false;
    };
  }, [code, closed, theme]);
  useLayoutEffect(() => {
    const target = holder.current;
    if (!target) return;
    target.replaceChildren(...(svg && view === "diagram" ? [svg] : []));
  }, [svg, view]);
  const drawn = svg !== null && view === "diagram";
  return (
    <div className="code-block mermaid-block" data-test-block="mermaid">
      <div className="code-header">
        <span className="code-lang">Mermaid</span>
        {svg ? (
          // biome-ignore lint/a11y/useSemanticElements: two toggle buttons inside a code header row, where a fieldset's box would break the row.
          <span className="mermaid-views" role="group" aria-label="Show">
            <button
              type="button"
              aria-pressed={view === "diagram"}
              onClick={() => setView("diagram")}
            >
              Diagram
            </button>
            <button type="button" aria-pressed={view === "code"} onClick={() => setView("code")}>
              Code
            </button>
          </span>
        ) : null}
        <CopyButton text={code} label="Copy code" />
      </div>
      <div ref={holder} className="mermaid-diagram" hidden={!drawn} />
      {drawn ? null : (
        <pre aria-busy={!closed}>
          <code>{code}</code>
        </pre>
      )}
      {problem ? <p className="mermaid-problem">{problem}</p> : null}
    </div>
  );
}
