// Typed access to the data files under /library. The JSON is imported at build time, so the app
// needs no file access to read it; scripts/check-library.mjs validates the files in CI.

import iso128 from '@library/line-types/iso-128-2.json';

export interface LineType {
  id: string;
  name: string;
  width: 'narrow' | 'wide';
  use: string;
  source: string;
  /** Dash/gap lengths in multiples of the line width; absent = continuous (see docs/to-verify.md). */
  pattern?: number[];
}
export interface LineTypeLibrary {
  id: string;
  name: string;
  source: string;
  unit: 'mm';
  widths: number[];
  narrowToWide: number;
  types: LineType[];
}

export const LINE_TYPES: LineTypeLibrary = iso128 as LineTypeLibrary;

export const lineType = (id: string): LineType | undefined => LINE_TYPES.types.find((t) => t.id === id);

/** The ISO 128-2 width series (mm). */
export const LINE_WIDTHS: readonly number[] = LINE_TYPES.widths;
