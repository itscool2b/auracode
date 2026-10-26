import { Page } from "../ui";
export const meta = () => [{ title: "Terms · auracode" }];
export default function Terms() {
  return (
    <Page eyebrow="TERMS / PRE-RELEASE DRAFT" title="A clear place to start.">
      <article className="prose">
        <p className="lead">Cloud access is an invite-only private preview.</p>
        <p>
          These product terms are a draft, not final launch terms. Operator identification, contact
          details, applicable rights and legal review are required before public accounts or
          releases become available. A website’s domain suffix does not determine your legal rights
          or the operator’s jurisdiction.
        </p>
        <h2>Your agents and your decisions</h2>
        <p>
          auracode provides a workspace for agents you choose. Their services, subscriptions and
          restrictions remain their own. Review generated work before relying on it. You remain
          responsible for choosing which files and tools an agent may access.
        </p>
        <h2>Your content and access</h2>
        <p>
          You retain your rights in your content. Use the app and service only with systems and
          information you are authorized to access. Do not use the cloud service to distribute
          malware, evade access controls or disrupt other users.
        </p>
        <h2>Account and recovery</h2>
        <p>
          Cloud accounts, sync and transfers require an invited email address. There is no paid
          access tier. Local desktop use remains free and needs no invitation.
        </p>
        <p>
          Keep access to your verified email, approved devices and recovery key secure. The service
          cannot recover encrypted content without a valid device key or recovery secret. Revoking a
          device stops future cloud access, but cannot erase its existing local copies.
        </p>
        <h2>Availability</h2>
        <p>
          Preview software and cloud features may change. Storage limits are shown in your account.
          Keep your own backups and use the export controls before deleting an account. Final
          release notes will identify supported systems, signing status and known limitations.
        </p>
        <h2>Local use</h2>
        <p>
          The Local desktop app is free and works without an account or network connection. Agent
          providers may still need a connection for their own services.
        </p>
        <a className="text-link" href="/privacy">
          Read the privacy notice ↗
        </a>
      </article>
    </Page>
  );
}
