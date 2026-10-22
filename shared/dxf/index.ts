// DXF import and export (docs/dxf.md). Pure functions on text and documents: the main process
// reads and writes the files, the UI shows the warnings and export notes.

export { readDxf, layerIdFromName, MAX_BLOCK_DEPTH, type DxfReadResult, type DxfReadError } from './read';
export { writeDxf, dxfExportNotes, R12_FLATTEN_TOLERANCE } from './write';
export {
  DXF_VERSIONS,
  DXF_LINETYPES,
  ISO_TO_DXF_LINETYPE,
  INSUNITS_TO_MM,
  dxfLineTypeFor,
  isoLineTypeFor,
  aciToRgb,
  nearestAci,
  type DxfVersion,
  type DxfWarning,
  type DxfLineTypeName,
} from './codes';
