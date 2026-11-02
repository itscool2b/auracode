import { ImageOff, RotateCcw, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { ChatImage, ChatImageContext, ChatImageSource } from "../../bindings";
import { type ChatImagesApi, ImagePreviews } from "../../lib/chatImages";
import { errorMessage } from "../../lib/errors";
import { Modal } from "./Modal";

const Context = createContext<{
  api: ChatImagesApi;
  chatId: string;
  previews: ImagePreviews;
} | null>(null);

export function ChatImagesProvider({
  chatId,
  api,
  children,
}: {
  readonly chatId: string;
  readonly api?: ChatImagesApi;
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => (api ? { api, chatId, previews: new ImagePreviews(api, chatId) } : null),
    [api, chatId],
  );
  useEffect(() => () => value?.previews.clear(), [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function Preview({
  source,
  name,
  full = false,
}: {
  readonly source: ChatImageSource;
  readonly name: string;
  readonly full?: boolean;
}) {
  const context = useContext(Context);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    url?: string;
    width?: number;
    height?: number;
    error?: string;
  }>({});
  const key = JSON.stringify(source);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly invalidates a failed read.
  useEffect(() => {
    setState({});
    if (!context) {
      setState({ error: "Image previews are unavailable here." });
      return;
    }
    let active = true;
    const preview = context.previews.acquire(JSON.parse(key) as ChatImageSource, full);
    void preview.promise.then(
      (value) => {
        if (active) setState(value);
      },
      (error: unknown) => {
        if (active) setState({ error: errorMessage(error) });
      },
    );
    return () => {
      active = false;
      preview.release();
    };
  }, [context, key, full, retry]);
  if (state.error)
    return (
      <span className="chat-image-unavailable" title={state.error} role="status">
        <ImageOff size={20} />
        <span>Image unavailable</span>
        {full && context ? (
          <button type="button" onClick={() => setRetry(retry + 1)}>
            <RotateCcw size={14} />
            Retry
          </button>
        ) : null}
      </span>
    );
  if (!state.url)
    return (
      <span className="chat-image-loading" role="status">
        Loading image…
      </span>
    );
  return (
    <img
      src={state.url}
      alt={name}
      width={state.width}
      height={state.height}
      decoding="async"
      onError={() => setState({ error: "The image could not be displayed." })}
    />
  );
}

export function ChatImageTile({
  image,
  onRemove,
}: {
  readonly image: ChatImage;
  readonly onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="chat-image" data-draft={Boolean(onRemove)}>
      <button
        type="button"
        className="chat-image-open"
        aria-label={`View ${image.name}`}
        onClick={() => setOpen(true)}
      >
        <Preview source={image.source} name={image.name} />
        <span className="chat-image-name" title={image.name}>
          {image.name}
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="chat-image-remove"
          aria-label={`Remove ${image.name}`}
          onClick={onRemove}
        >
          <X size={14} />
        </button>
      ) : null}
      {open ? (
        <Modal
          title={image.name}
          size="lg"
          className="chat-image-dialog"
          onClose={() => setOpen(false)}
        >
          <Preview source={image.source} name={image.name} full />
        </Modal>
      ) : null}
    </span>
  );
}

export function MessageImages({ context: message }: { readonly context: ChatImageContext }) {
  const context = useContext(Context);
  const [images, setImages] = useState<ChatImage[]>([]);
  const key = JSON.stringify(message);
  useEffect(() => {
    setImages([]);
    if (!context) return;
    let active = true;
    void context.api.list(context.chatId, JSON.parse(key) as ChatImageContext).then(
      (value) => {
        if (active) setImages(value.slice(0, 8));
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [context, key]);
  return images.length ? (
    <section className="chat-image-gallery" aria-label="Attached images">
      {images.map((image) => (
        <ChatImageTile key={JSON.stringify(image.source)} image={image} />
      ))}
    </section>
  ) : null;
}
