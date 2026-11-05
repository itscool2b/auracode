/**
 * Stands in for elkjs, which Mermaid imports for its optional ELK layout. elkjs is EPL-2.0 or
 * GPL-3.0, so auracode does not ship it (vite.config.ts aliases it here, and the third-party
 * notices leave it out for that reason). A diagram asking for the ELK layout shows its code with
 * this message; Mermaid's default layout draws everything else.
 */
export default class ELK {
  constructor() {
    throw new Error("auracode does not include Mermaid's ELK layout. Its default layout works.");
  }
}
