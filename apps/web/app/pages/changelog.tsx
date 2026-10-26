import { Page } from "../ui";
export const meta = () => [{ title: "Changelog · auracode" }];
export default function Changelog() {
  return (
    <Page eyebrow="DEVELOPMENT NOTES" title="Taking shape.">
      <article className="release">
        <time dateTime="2026-10-26">26 OCT 2026</time>
        <div>
          <span className="status">Development preview</span>
          <h2>One workspace. Your own agents.</h2>
          <p>
            The Windows and macOS desktop brings native coding agents into a shared local workspace.
            The current work includes tool transcripts, approval flows, project organization and a
            dark interface.
          </p>
          <h3>Account and sync foundation</h3>
          <p>
            The Rust cloud API implements email-code sign-in, device approval, encrypted record
            sync, private file storage and account controls. Preview deployment, email delivery
            qualification and end-to-end acceptance are still pending.
          </p>
          <h3>Release status</h3>
          <p>
            No public signed installer is published yet. This page will link versioned release
            notes, checksums and known issues when each release is available.
          </p>
          <a className="text-link" href="/download">
            View download status ↗
          </a>
        </div>
      </article>
    </Page>
  );
}
