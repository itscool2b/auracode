import { Page } from "../ui";
export const meta = () => [{ title: "Privacy · auracode" }];
export default function Privacy() {
  return (
    <Page eyebrow="PRIVACY / PRE-RELEASE NOTICE" title="Your work stays yours.">
      <article className="prose">
        <p className="lead">Local work needs no account. Cloud sync is optional.</p>
        <p>
          This notice describes the implemented design as of October 26, 2026. Operator identity,
          legal contact details and jurisdiction-specific terms require review before the account
          service opens to the public.
        </p>
        <h2>On your computer</h2>
        <p>
          Projects, chats and local agent sessions are stored on your machine. Your chosen agents
          run through their own harnesses and authentication. Their providers receive information
          according to their own services and policies. auracode does not copy your agent credential
          files into its cloud service.
        </p>
        <h2>If you create an account</h2>
        <p>
          The Rust account service stores your email, account identifier, hashed session tokens,
          device names and public keys, approval state, storage totals and timestamps. Sign-in codes
          expire after ten minutes and are stored as protected verifiers, not readable codes.
          Sessions expire after 30 days unless revoked sooner.
        </p>
        <h2>Optional encrypted sync</h2>
        <p>
          Workspace content and files are encrypted on your device before upload. The service stores
          encrypted records, encrypted key envelopes and private file objects. It can see routing
          metadata such as account, device and record identifiers, change order, deletion markers
          and sizes. It does not receive your plaintext account key or recovery secret.
        </p>
        <p>
          Cloudflare hosts the Worker, D1 database and private R2 storage. Cloudflare Email Service
          delivers requested codes, and Turnstile checks sign-in requests. The service processes the
          connecting IP for request limits and Turnstile verification. Rate-limit keys are protected
          hashes. No advertising analytics are included in this website.
        </p>
        <h2>Retention and deletion</h2>
        <p>
          Encrypted history is retained until account deletion and counts toward your quota.
          Superseded file objects become eligible for cleanup after their lease expires. Expired
          challenges, rate limits and sessions are cleaned up on a schedule.
        </p>
        <p>
          Deleting your account immediately revokes access. Scheduled cleanup removes account data
          and private files, retrying failures. A random account-ID tombstone remains so an upload
          already in flight can be removed later. Local copies and data already downloaded by a
          device are not remotely erased.
        </p>
        <p>
          A receipt of each session valid at deletion retains only its token hash, client type,
          request-verification hash and deletion and expiry times. It lets that device recognize
          deletion without signing in again. Receipts expire with the original session, within 30
          days, and scheduled cleanup removes expired receipts. They contain no email or account
          identifier.
        </p>
        <h2>Your controls</h2>
        <p>
          Use Account to revoke a device, sign out everywhere, change your verified email, download
          an encrypted archive or delete the account after a fresh code. Keep your recovery key
          safe. Without an approved device or recovery key, the service cannot decrypt your
          workspace for you.
        </p>
        <a className="text-link" href="/account">
          Manage your account ↗
        </a>
      </article>
    </Page>
  );
}
