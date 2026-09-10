/**
 * pdf-parse ships no type declarations, so both resume routes imported it as an
 * implicit `any` and TypeScript errored (TS7016). Declaring the surface we
 * actually use keeps `tsc --noEmit` clean without pulling in a stale
 * @types package.
 */
declare module 'pdf-parse' {
  interface PDFInfo {
    PDFFormatVersion?: string
    IsAcroFormPresent?: boolean
    IsXFAPresent?: boolean
    Title?: string
    Author?: string
    [key: string]: unknown
  }

  interface PDFData {
    /** Number of pages. */
    numpages: number
    /** Number of rendered pages. */
    numrender: number
    /** Document info dictionary. */
    info: PDFInfo
    /** XMP metadata, when present. */
    metadata: unknown
    /** pdf.js version used. */
    version: string
    /** Extracted text content. */
    text: string
  }

  interface PDFOptions {
    /** Stop after this many pages; 0 (default) means all. */
    max?: number
    version?: string
    pagerender?: (pageData: unknown) => string | Promise<string>
  }

  function pdf(dataBuffer: Buffer | Uint8Array, options?: PDFOptions): Promise<PDFData>

  export = pdf
}
