import catalog from "#release-catalog";
import { Arrow, Page } from "../ui";

export const meta = () => [{ title: "Changelog · auracode" }];

export default function Changelog() {
  return (
    <Page wide title="Changelog." tone="Notes from the preview.">
      <article className="release-entry" data-reveal="">
        <div className="release-meta">
          <time dateTime="2026-10-26">26 October 2026</time>
          <span>Development preview</span>
        </div>
        <div className="release-body prose">
          <h2>One workspace. Your own agents.</h2>
          <p>
            The Windows and macOS desktop brings native coding agents into a shared local workspace.
            The current work includes tool transcripts, approval flows, project organization and a
            dark interface.
          </p>
          <h3>Account and sync foundation</h3>
          <p>
            The Rust cloud API implements email-code sign-in, device approval, encrypted record
            sync, private file storage and account controls. Cloud accounts, sync and transfers are
            invite-only during private preview. Local desktop use needs no invitation.
          </p>
          <h3>Release status</h3>
          <p>
            {catalog.release
              ? `Version ${catalog.release.version} is available. The download page includes its release notes, platform requirements and checksums.`
              : "No public installer is published yet. This page will link versioned release notes, checksums and known issues when each release is available."}
          </p>
          <a className="text-link" href="/download">
            View download status <Arrow />
          </a>
        </div>
      </article>
    </Page>
  );
}
