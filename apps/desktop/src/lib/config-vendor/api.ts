import { invoke } from "@tauri-apps/api/core";
import { toCommandError } from "../ipc";
import { type TerminalTransport, terminalTransport } from "../terminal";
import type { VendorRequest, VendorReview } from "./bindings";

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toCommandError(error);
  }
}
export interface VendorApi {
  review(request: VendorRequest): Promise<VendorReview>;
  cancel(token: string): Promise<void>;
  terminal(review: VendorReview): TerminalTransport;
}
export const vendorApi: VendorApi = {
  review: (request) => call("config_vendor_review", { request }),
  cancel: (token) => call("config_vendor_cancel", { token }),
  terminal: (review) => ({
    ...terminalTransport,
    start: (terminalId, _agentId, size) =>
      call("config_vendor_start", {
        token: review.token,
        terminalId,
        rows: size.rows,
        cols: size.cols,
      }),
  }),
};
