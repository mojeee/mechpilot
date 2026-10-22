// Italian translations of the sketch solver messages (shared/sketch). Key = the English text passed to t().
const it: Record<string, string> = {
  // ---------- names ----------
  'line {id}': 'linea {id}',
  'circle {id}': 'cerchio {id}',
  'arc {id}': 'arco {id}',
  'polyline {id}': 'polilinea {id}',
  'dimension {id}': 'quota {id}',
  'entity {id}': 'entità {id}',
  'constraint {id}': 'vincolo {id}',
  'the start of line {id}': 'l’inizio della linea {id}',
  'the end of line {id}': 'la fine della linea {id}',
  'the centre of circle {id}': 'il centro del cerchio {id}',
  'the centre of arc {id}': 'il centro dell’arco {id}',
  'the start of arc {id}': 'l’inizio dell’arco {id}',
  'the end of arc {id}': 'la fine dell’arco {id}',
  'vertex {n} of polyline {id}': 'il vertice {n} della polilinea {id}',
  '{list} and {last}': '{list} e {last}',

  // ---------- constraints in words ----------
  'the coincident constraint between {a} and {b}': 'il vincolo di coincidenza tra {a} e {b}',
  'the point-on-line constraint of {p} on {line}': 'il vincolo punto su linea di {p} su {line}',
  'the horizontal constraint on {e}': 'il vincolo orizzontale su {e}',
  'the vertical constraint on {e}': 'il vincolo verticale su {e}',
  'the parallel constraint between {a} and {b}': 'il vincolo di parallelismo tra {a} e {b}',
  'the perpendicular constraint between {a} and {b}': 'il vincolo di perpendicolarità tra {a} e {b}',
  'the tangent constraint between {a} and {b}': 'il vincolo di tangenza tra {a} e {b}',
  'the equal constraint between {a} and {b}': 'il vincolo di uguaglianza tra {a} e {b}',
  'the symmetry of {a} and {b} about {line}': 'la simmetria di {a} e {b} rispetto a {line}',
  'the fixed constraint on {e}': 'il vincolo di blocco su {e}',
  'the distance {v} mm between {a} and {b}': 'la distanza {v} mm tra {a} e {b}',
  'the distance {v} mm from {p} to {line}': 'la distanza {v} mm da {p} a {line}',
  'the angle {v}° between {a} and {b}': 'l’angolo {v}° tra {a} e {b}',
  'the radius {v} mm of {e}': 'il raggio {v} mm di {e}',
  'the driving dimension {v} mm ({name})': 'la quota guida {v} mm ({name})',
  'the driving dimension {v}° ({name})': 'la quota guida {v}° ({name})',

  // ---------- diagnosis ----------
  'No constraints yet: the sketch has 1 degree of freedom.': 'Ancora nessun vincolo: lo schizzo ha 1 grado di libertà.',
  'No constraints yet: the sketch has {n} degrees of freedom.': 'Ancora nessun vincolo: lo schizzo ha {n} gradi di libertà.',
  'Over-constrained: {a} conflicts with {b}. Remove one of them.': 'Sovravincolato: {a} è in conflitto con {b}. Eliminane uno.',
  'Over-constrained: these constraints cannot all hold: {list}. Remove one of them.':
    'Sovravincolato: questi vincoli non possono valere tutti insieme: {list}. Eliminane uno.',
  'Over-constrained: {a} cannot hold with the other constraints. Remove it or change its value.':
    'Sovravincolato: {a} non può valere insieme agli altri vincoli. Eliminalo o cambiane il valore.',
  'Solved, but {a} is redundant: the other constraints already fix the same thing. You can delete it.':
    'Risolto, ma {a} è ridondante: gli altri vincoli fissano già la stessa cosa. Puoi eliminarlo.',
  'Solved, but these constraints are redundant: {list}. The other constraints already fix the same things; you can delete them.':
    'Risolto, ma questi vincoli sono ridondanti: {list}. Gli altri vincoli fissano già le stesse cose; puoi eliminarli.',
  'The sketch is too large for the solver: {detail}. Split it into smaller groups of connected geometry.':
    'Lo schizzo è troppo grande per il risolutore: {detail}. Dividilo in gruppi più piccoli di geometria collegata.',
  'The constraint solver stopped with an internal error ({detail}). Undo the last change and try again.':
    'Il risolutore dei vincoli si è fermato per un errore interno ({detail}). Annulla l’ultima modifica e riprova.',
  'The solver could not satisfy the constraints from the current shape. Some may contradict each other (for example an angle between two horizontal lines), or the geometry is too far from the intended shape: move it closer and try again.':
    'Il risolutore non riesce a soddisfare i vincoli partendo dalla forma attuale. Alcuni potrebbero contraddirsi (per esempio un angolo tra due linee orizzontali), oppure la geometria è troppo lontana dalla forma voluta: avvicinala e riprova.',
  'Solved; fully constrained.': 'Risolto; completamente vincolato.',
  'Solved. The sketch has 1 degree of freedom left (for example {e} can still move).': 'Risolto. Lo schizzo ha ancora 1 grado di libertà (per esempio {e} può ancora muoversi).',
  'Solved. The sketch has {n} degrees of freedom left (for example {e} can still move).': 'Risolto. Lo schizzo ha ancora {n} gradi di libertà (per esempio {e} può ancora muoversi).',
  'Solved. The sketch has 1 degree of freedom left.': 'Risolto. Lo schizzo ha ancora 1 grado di libertà.',
  'Solved. The sketch has {n} degrees of freedom left.': 'Risolto. Lo schizzo ha ancora {n} gradi di libertà.',
  'Partly redundant: {list}.': 'Parzialmente ridondanti: {list}.',
  'Driving dimensions not applied, because their points are not on sketch geometry (or the direction is not horizontal or vertical): {list}.':
    'Quote guida non applicate, perché i loro punti non sono sulla geometria dello schizzo (o la direzione non è orizzontale o verticale): {list}.',
  'Constraints ignored, because they refer to geometry the solver does not handle (ellipses, splines, text): {list}.':
    'Vincoli ignorati, perché riguardano geometria che il risolutore non gestisce (ellissi, spline, testo): {list}.',
  'Polylines with arcs take part only as fixed points: {list}. Explode them into lines and arcs to constrain them.':
    'Le polilinee con archi partecipano solo come punti fissi: {list}. Esplodile in linee e archi per vincolarle.',
  '{n} entities in one connected group, {u} unknowns': '{n} entità in un unico gruppo collegato, {u} incognite',
};
export default it;
