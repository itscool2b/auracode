import { createContext, useCallback, useContext, useState } from "react";

interface Choice {
  readonly phase: string;
  readonly open: boolean;
}

/** Manual disclosure choices belong to the chat, not to the lifetime of a virtual row. */
export type DisclosureChoices = Map<string, Choice>;
export const DisclosureMemory = createContext<DisclosureChoices | null>(null);

export function useDisclosure(key: string, phase: string, initial: boolean) {
  const memory = useContext(DisclosureMemory);
  const [choice, setChoice] = useState(() => memory?.get(key));
  const open = choice?.phase === phase ? choice.open : initial;
  const setOpen = useCallback(
    (value: boolean) => {
      const next = { phase, open: value };
      memory?.set(key, next);
      setChoice(next);
    },
    [key, memory, phase],
  );
  return [open, setOpen] as const;
}
