import {
  commands,
  type RepositoryPublicationDraft,
  type RepositoryPublicationInput,
  type RepositoryPublicationResult,
  type RepositoryPublicationReview,
} from "../bindings";
import { settle } from "./ipc";
export interface RepositoryPublicationApi {
  draft(folderId: string): Promise<RepositoryPublicationDraft | null>;
  review(folderId: string, input: RepositoryPublicationInput): Promise<RepositoryPublicationReview>;
  apply(folderId: string, token: string): Promise<RepositoryPublicationResult>;
}
export const repositoryPublicationApi: RepositoryPublicationApi = {
  draft: (folderId) => settle(commands.repositoryPublicationDraft(folderId)),
  review: (folderId, input) => settle(commands.repositoryPublicationReview(folderId, input)),
  apply: (folderId, token) => settle(commands.repositoryPublicationApply(folderId, token)),
};
