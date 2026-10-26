import { useEffect, useState } from "react";
import catalog from "#release-catalog";
import { Page } from "../ui";
export const meta = () => [{ title: "Download auracode · Windows and macOS" }];
export default function Download() {
  const [detected, setDetected] = useState("");
  const release = catalog.release;
  useEffect(() => {
    setDetected(
      /Mac/i.test(navigator.platform) ? "macOS" : /Win/i.test(navigator.platform) ? "Windows" : "",
    );
  }, []);
  return (
    <Page eyebrow="YOUR LOCAL WORKSPACE" title="Bring your agents home.">
      <p className="lead">
        {release
          ? `auracode ${release.version} for Windows and macOS.`
          : "auracode is being prepared for Windows and macOS."}
        <br />
        Choose your platform. You can always use a different one.
      </p>
      {detected && <p className="caption">You appear to be using {detected}.</p>}
      {release?.channel === "staging" && (
        <p className="caption" role="status">
          Staging preview. These builds are for release qualification.
        </p>
      )}
      <div className="downloads">
        {release
          ? release.downloads.map((download) => (
              <article className="download-panel" key={download.kind}>
                <p className="eyebrow">VERSION {release.version}</p>
                <h2>{download.label}</h2>
                <p>{download.requirements}</p>
                <div className="data-row">
                  <span>Package</span>
                  <span>{download.file}</span>
                </div>
                <div className="data-row">
                  <span>Size</span>
                  <span>{(download.bytes / 1024 / 1024).toFixed(1)} MiB</span>
                </div>
                <div className="data-row checksum">
                  <span>SHA-256</span>
                  <code>{download.sha256}</code>
                </div>
                <a className="button primary" href={download.url}>
                  Download {download.label}
                </a>
              </article>
            ))
          : [
              {
                name: "macOS",
                architectures: "Apple silicon + Intel",
                format: "Universal DMG",
                requirements: "macOS 13.3 or newer",
              },
              {
                name: "Windows",
                architectures: "x64 + ARM64",
                format: "NSIS installer",
                requirements: "Windows 10 or newer, with Microsoft Edge WebView2",
              },
            ].map((os) => (
              <article className="download-panel" key={os.name}>
                <p className="eyebrow">{os.architectures}</p>
                <h2>{os.name}</h2>
                <p>{os.requirements}</p>
                <div className="data-row">
                  <span>Package</span>
                  <span>{os.format}</span>
                </div>
                <div className="data-row">
                  <span>Public version</span>
                  <span>Not published</span>
                </div>
                <div className="data-row">
                  <span>SHA-256</span>
                  <span>Available with release</span>
                </div>
                <button type="button" className="button secondary" disabled>
                  Installer coming soon
                </button>
              </article>
            ))}
      </div>
      {release && (
        <section className="prose" aria-labelledby="release-notes">
          <h2 id="release-notes">Release notes · {release.version}</h2>
          <p>
            <time dateTime={release.pub_date}>{release.pub_date.slice(0, 10)}</time>
          </p>
          <p className="release-notes">{release.notes}</p>
          <a className="text-link" href={release.checksums_url}>
            All SHA-256 checksums ↗
          </a>
        </section>
      )}
      <section className="prose">
        <h2>Before you install</h2>
        <p>
          {release
            ? "Compare the downloaded file's SHA-256 checksum with the value above before installing. Platform trust and updater signatures are separate checks."
            : "Installers, checksums, and versioned release notes will appear here together. There is no public download to verify yet."}
        </p>
        <p>
          Preview builds may be unsigned. Review the source and build provenance before running one.
          If your system blocks a build, stop and report the exact warning. Do not disable
          operating-system security protections.
        </p>
        <p>
          The base app works offline. Install and sign in to your chosen coding agent through its
          own supported workflow. An auracode account is optional.
        </p>
        <a className="text-link" href="/changelog">
          Read development notes ↗
        </a>
      </section>
    </Page>
  );
}
