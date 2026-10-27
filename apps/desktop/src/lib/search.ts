import { commands, type SearchResults } from "../bindings";
import { settle } from "./ipc";

export interface SearchTransport {
  search(query: string, includeArchived: boolean): Promise<SearchResults>;
}
export const searchApi: SearchTransport = {
  search: (query, includeArchived) => settle(commands.workspaceSearch(query, includeArchived)),
};
