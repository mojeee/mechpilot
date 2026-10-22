// Italian translations of DXF import and export (shared/dxf). Key = the English text passed to t().
const it: Record<string, string> = {
  // ---------- unit names ($INSUNITS) ----------
  inches: 'pollici',
  feet: 'piedi',
  miles: 'miglia',
  millimetres: 'millimetri',
  centimetres: 'centimetri',
  metres: 'metri',
  kilometres: 'chilometri',
  microinches: 'micropollici',
  'mils (thousandths of an inch)': 'mil (millesimi di pollice)',
  yards: 'iarde',
  ångströms: 'ångström',
  nanometres: 'nanometri',
  micrometres: 'micrometri',
  decimetres: 'decimetri',
  decametres: 'decametri',
  hectometres: 'ettometri',
  gigametres: 'gigametri',
  'astronomical units': 'unità astronomiche',
  'light-years': 'anni luce',
  parsecs: 'parsec',
  'US survey feet': 'piedi topografici USA',
  'US survey inches': 'pollici topografici USA',
  'US survey yards': 'iarde topografiche USA',
  'US survey miles': 'miglia topografiche USA',

  // ---------- import ----------
  '{n} layers used by the drawing were missing from the layer table and were created with default settings: {names}.':
    '{n} layer usati dal disegno mancavano dalla tabella dei layer e sono stati creati con le impostazioni predefinite: {names}.',
  '{n} line types are not known to MechPilot and were drawn as continuous narrow lines (01.1): {names}.':
    '{n} tipi di linea non sono noti a MechPilot e sono stati disegnati come linee continue fini (01.1): {names}.',
  '{n} entities of type {type} are not supported yet and were skipped.': '{n} entità di tipo {type} non sono ancora supportate e sono state saltate.',
  '{n} entities of type {type} had invalid geometry (for example a zero radius or too few points) and were skipped.':
    '{n} entità di tipo {type} avevano una geometria non valida (per esempio raggio zero o troppo pochi punti) e sono state saltate.',
  '{n} entities drawn on paper-space layouts (title blocks, viewports) were skipped; only model space is imported.':
    '{n} entità disegnate nei layout dello spazio carta (cartigli, finestre) sono state saltate; si importa solo lo spazio modello.',
  '{n} entities had their own colour, line type or line width; MechPilot draws every entity with the settings of its layer, so these were not kept.':
    '{n} entità avevano un proprio colore, tipo o spessore di linea; MechPilot disegna ogni entità con le impostazioni del suo layer, quindi non sono stati mantenuti.',
  '{n} 3D polylines or meshes were skipped; only 2D polylines are imported.': '{n} polilinee 3D o mesh sono state saltate; si importano solo polilinee 2D.',
  '{n} splines with weights (rational splines) were converted to polylines that follow the curve closely; MechPilot splines have no weights.':
    '{n} spline con pesi (spline razionali) sono state convertite in polilinee che seguono da vicino la curva; le spline di MechPilot non hanno pesi.',
  '{n} blocks were inserted but not defined in the file (or are external references) and were skipped: {names}.':
    '{n} blocchi erano inseriti ma non definiti nel file (o sono riferimenti esterni) e sono stati saltati: {names}.',
  '{n} block inserts were nested more than {max} levels deep and were skipped.': '{n} inserimenti di blocco erano annidati oltre {max} livelli e sono stati saltati.',
  '{n} block inserts had different x and y scales; MechPilot used the x scale for both.':
    '{n} inserimenti di blocco avevano scale x e y diverse; MechPilot ha usato la scala x per entrambe.',
  'This file is not a DXF drawing.': 'Questo file non è un disegno DXF.',
  'A DXF file is text with SECTION headers and an ENTITIES section. Check that you picked the right file, or export it again as DXF (R12 or 2000) from the program that made it.':
    'Un file DXF è testo con intestazioni SECTION e una sezione ENTITIES. Verifica di aver scelto il file giusto, oppure esportalo di nuovo come DXF (R12 o 2000) dal programma che l’ha creato.',
  'This is a binary DXF file, which MechPilot cannot read yet.': 'Questo è un file DXF binario, che MechPilot non sa ancora leggere.',
  'Save the drawing again as an ASCII (text) DXF from the program that made it.': 'Salva di nuovo il disegno come DXF ASCII (testo) dal programma che l’ha creato.',
  'The file does not say which unit it uses, so millimetres were assumed. If the drawing looks 25.4 times too small, it was drawn in inches.':
    'Il file non indica l’unità di misura, quindi sono stati assunti i millimetri. Se il disegno sembra 25,4 volte troppo piccolo, era disegnato in pollici.',
  'The drawing was in inches; every length was converted to millimetres (× 25.4).': 'Il disegno era in pollici; ogni lunghezza è stata convertita in millimetri (× 25,4).',
  'The file uses an unknown unit code ({code}), so millimetres were assumed.': 'Il file usa un codice di unità sconosciuto ({code}), quindi sono stati assunti i millimetri.',
  'The drawing was in {unit}; every length was converted to millimetres (× {factor}).': 'Il disegno era in {unit}; ogni lunghezza è stata convertita in millimetri (× {factor}).',
  'The drawing had 3D coordinates; the z values were dropped and the drawing was read as seen from above.':
    'Il disegno aveva coordinate 3D; i valori z sono stati scartati e il disegno è stato letto come visto dall’alto.',
  'Imported DXF': 'DXF importato',

  // ---------- export ----------
  '{n} ellipses will be written as polylines that follow the curve within {tol} mm, because DXF R12 has no ellipse entity. Choose DXF 2000 to keep them exact.':
    '{n} ellissi saranno scritte come polilinee che seguono la curva entro {tol} mm, perché il DXF R12 non ha l’entità ellisse. Scegli DXF 2000 per mantenerle esatte.',
  '{n} splines will be written as polylines that follow the curve within {tol} mm, because DXF R12 has no spline entity. Choose DXF 2000 to keep them exact.':
    '{n} spline saranno scritte come polilinee che seguono la curva entro {tol} mm, perché il DXF R12 non ha l’entità spline. Scegli DXF 2000 per mantenerle esatte.',
  '{n} layer names have spaces, special characters or more than 31 characters; programs that read DXF R12 strictly may change them: {names}.':
    '{n} nomi di layer contengono spazi, caratteri speciali o più di 31 caratteri; i programmi che leggono il DXF R12 in modo rigoroso potrebbero cambiarli: {names}.',
  '{n} layers will get a different name in the DXF file, because DXF does not allow some characters or two names that differ only in capitals: {names}.':
    '{n} layer avranno un nome diverso nel file DXF, perché il DXF non ammette alcuni caratteri né due nomi che differiscono solo per le maiuscole: {names}.',
  '{n} texts have line breaks; DXF TEXT holds one line, so the lines will be joined with spaces.':
    '{n} testi contengono a capo; il TEXT del DXF contiene una sola riga, quindi le righe saranno unite con spazi.',
};
export default it;
