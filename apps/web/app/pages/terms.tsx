import { Arrow, Page } from "../ui";
export const meta = () => [{ title: "Terms · o7" }];
export default function Terms() {
  return (
    <Page
      title="Terms."
      tone="A clear place to start."
      lead="A free desktop app that runs on your computer, with no account."
    >
      <article className="prose">
        <p>
          These product terms are a draft, not final launch terms. Operator identification, contact
          details, applicable rights and legal review are required before public releases become
          available. A website’s domain suffix does not determine your legal rights or the
          operator’s jurisdiction.
        </p>
        <h2>Your agents and your decisions</h2>
        <p>
          o7 provides a workspace for agents you choose. Their services, subscriptions and
          restrictions remain their own. Review generated work before relying on it. You remain
          responsible for choosing which files and tools an agent may access.
        </p>
        <h2>Your content and access</h2>
        <p>
          You retain your rights in your content. Use the app only with systems and information you
          are authorized to access. Do not use the app, its remote access or this website to
          distribute malware, evade access controls or disrupt other people.
        </p>
        <h2>Your data</h2>
        <p>
          Your chats, projects and settings are files on your computer. There is no o7 account and
          no copy of them on a server, so nobody can restore them for you. Keep your own backups.
        </p>
        <h2>Availability</h2>
        <p>
          Preview software may change. Final release notes will identify supported systems, signing
          status and known limitations.
        </p>
        <h2>Local use</h2>
        <p>
          The desktop app is free and works without a network connection. There is no paid tier.
          Agent providers may still need a connection for their own services.
        </p>
        <a className="text-link" href="/privacy">
          Read the privacy notice <Arrow />
        </a>
      </article>
    </Page>
  );
}
