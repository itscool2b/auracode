import catalog from "#release-catalog";
import { Arrow, Page } from "../ui";

export const meta = () => [{ title: "Download auracode · Windows and macOS" }];

const PLATFORMS = [
  {
    name: "macOS",
    architectures: "Apple silicon and Intel",
    format: "Universal DMG",
    requirements: "macOS 13.3 or newer",
  },
  {
    name: "Windows",
    architectures: "x64 and ARM64",
    format: "NSIS installer",
    requirements: "Windows 10 or newer, with Microsoft Edge WebView2",
  },
] as const;

export default function Download() {
  const release = catalog.release;
  return (
    <Page
      wide
      title="Download auracode."
      tone="Free, local, no account."
      lead={
        release
          ? `Version ${release.version} for Windows and macOS.`
          : "Installers for Windows and macOS are on the way."
      }
    >
      {release?.channel === "staging" ? (
        <p className="note download-status" role="status">
          Staging preview. These builds are for release qualification.
        </p>
      ) : null}
      <div className="download-grid" data-reveal="">
        {release
          ? release.downloads.map((download) => (
              <article className="download-cell" key={download.kind}>
                <div>
                  <h2 className="download-name">{download.label}</h2>
                  <p className="download-sub">{download.requirements}</p>
                </div>
                <dl className="data-rows">
                  <div className="data-row">
                    <dt>Version</dt>
                    <dd className="mono">{release.version}</dd>
                  </div>
                  <div className="data-row">
                    <dt>Package</dt>
                    <dd className="mono">{download.file}</dd>
                  </div>
                  <div className="data-row">
                    <dt>Size</dt>
                    <dd className="mono">{(download.bytes / 1024 / 1024).toFixed(1)} MiB</dd>
                  </div>
                  <div className="data-row">
                    <dt>SHA-256</dt>
                    <dd>
                      <code className="mono">{download.sha256}</code>
                    </dd>
                  </div>
                </dl>
                <div className="download-action">
                  <a className="g-button g-button-primary g-button-44" href={download.url}>
                    Download {download.label}
                  </a>
                </div>
              </article>
            ))
          : PLATFORMS.map((os) => (
              <article className="download-cell" key={os.name}>
                <div>
                  <h2 className="download-name">{os.name}</h2>
                  <p className="download-sub">{os.architectures}</p>
                </div>
                <dl className="data-rows">
                  <div className="data-row">
                    <dt>Requires</dt>
                    <dd>{os.requirements}</dd>
                  </div>
                  <div className="data-row">
                    <dt>Package</dt>
                    <dd>{os.format}</dd>
                  </div>
                  <div className="data-row">
                    <dt>Public version</dt>
                    <dd>Not published</dd>
                  </div>
                  <div className="data-row">
                    <dt>SHA-256</dt>
                    <dd>Available with release</dd>
                  </div>
                </dl>
                <div className="download-action">
                  <button type="button" className="g-button g-button-44" disabled>
                    Installer coming soon
                  </button>
                </div>
              </article>
            ))}
      </div>
      <div className="prose-sections">
        {release ? (
          <section className="prose prose-section" aria-labelledby="release-notes">
            <h2 id="release-notes">Release notes · {release.version}</h2>
            <p className="note">
              <time dateTime={release.pub_date}>{release.pub_date.slice(0, 10)}</time>
            </p>
            <p className="release-notes">{release.notes}</p>
            <a className="text-link" href={release.checksums_url}>
              All SHA-256 checksums <Arrow direction="up-right" />
            </a>
          </section>
        ) : null}
        <section className="prose prose-section" aria-labelledby="before-you-install">
          <h2 id="before-you-install">Before you install</h2>
          <p>
            {release
              ? "Compare the downloaded file's SHA-256 checksum with the value above before installing. Platform trust and updater signatures are separate checks."
              : "Installers, checksums, and versioned release notes will appear here together. There is no public download to verify yet."}
          </p>
          <p>
            Preview builds may be unsigned. Review the source and build provenance before running
            one. If your system blocks a build, stop and report the exact warning. Do not disable
            operating-system security protections.
          </p>
        </section>
      </div>
    </Page>
  );
}
