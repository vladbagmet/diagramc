declare module 'subset-font' {
  interface SubsetOptions {
    targetFormat?: 'sfnt' | 'truetype' | 'woff' | 'woff2';
    keepFeatures?: string[];
    preserveNameIds?: number[];
    noLayoutClosure?: boolean;
  }
  export default function subsetFont(font: Buffer, text: string, options?: SubsetOptions): Promise<Buffer>;
}
