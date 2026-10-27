/** Presentation-only discovery data, shared by the real interface and the design reference. */
export interface GlobeAgent {
  readonly id: string;
  readonly name: string;
  readonly status: "looking" | "found" | "missing";
  readonly path: string | null;
  readonly version: string | null;
  readonly signedIn: boolean | null;
  readonly installCommand?: string | null;
  readonly at: number | null;
}

export interface GlobeDiscovery {
  readonly status: "idle" | "scanning" | "done";
  readonly agents: readonly GlobeAgent[];
  readonly finishedAt: number | null;
}
