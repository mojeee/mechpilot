<!--
Italian text of the demo page (/it/demo/), translated from docs/demo.md: same "## N." sections and
the same number of quoted prompts in each. "source" is the hash the build prints when docs/demo.md
changes; update it together with the translation.
source: 454bea0cb6
-->
# Copione della demo: progettare scrivendo, indicare, modificare, stampare

Una dimostrazione di dodici minuti di MechPilot con l’assistente, per una demo dal vivo. Ogni
passo usa ciò che è incluso nel programma; l’assistente ha bisogno di una chiave API (scheda
Assistente). Il modello predefinito è Claude Opus 5.5. Nulla di ciò che l’assistente propone viene
applicato finché non premi Accetta, e ogni proposta accettata è un solo passo di annullamento
(`U`). La parte è un supporto per un cuscinetto a sfere 6207 (35 × 72 × 17 mm): una flangia
quadrata, un mozzo con la sede del cuscinetto, una lamatura per la tenuta, una corona di fori per
il coperchio.

## 0. Prima della demo

- Avvia il programma (`npm run dev` o il programma installato), tema scuro, area di disegno bianca
  se il proiettore è molto luminoso (menu Visualizza).
- Scheda Assistente: fornitore Claude, modello Claude Opus 5.5, chiave salvata (“Chiave salvata” in
  verde).
- Chiudi ogni file aperto: File > Nuovo.

## 1. Un supporto per cuscinetto da una frase (2D)

Scrivi nella scheda Assistente:

> Una flangia di supporto per un cuscinetto 6207: una piastra quadrata 140 × 140 mm con raggi R15
> agli angoli, quattro fori di passaggio Ø11 per M10 su un interasse di 110 × 110, due fori per
> spine Ø6 H7 su una diagonale a 60 mm dal centro e un foro centrale Ø72 H7 per l’anello esterno
> del cuscinetto.

Che cosa mostrare: la scheda della proposta elenca che cosa aggiungerà, le affermazioni dicono da
dove viene ogni numero (Ø11 per M10 da `library/holes/iso-273`, serie media; scostamenti H7 dalla
ISO 286) e il disegno mostra l’anteprima in trasparenza. Fai clic su **Accetta**. Premi `U` una
volta per mostrare che è un solo passo di annullamento, poi `REDO`.

## 2. Passo dopo passo fino alla parte 3D

> Rendila una parte 3D: estrudi la piastra di 15 mm con tutti i fori passanti.

Accetta. Si apre la scheda 3D con il corpo; la scheda Funzioni mostra l’albero. Poi:

> Aggiungi sopra un mozzo Ø100 alto 30 mm attorno al foro; mantieni il foro Ø72 H7 passante
> attraverso il mozzo e smussa entrambe le estremità del foro con 1 × 45°.

Accetta e ruota la vista. Poi il retro e il coperchio:

> Sulla faccia posteriore aggiungi una lamatura Ø80 profonda 4 mm per la tenuta dell’albero, e
> sulla sommità del mozzo una corona circolare di sei fori filettati M5 su un cerchio Ø88,
> profondi 10 mm.

Accetta. Poi una richiesta impossibile, per mostrare l’onestà:

> Porta lo spessore della parete del mozzo a 1 mm e raccorda i suoi spigoli con R15.

L’assistente risponde con i numeri reali del modello (la parete è di 14 mm, una parete di 1 mm non
regge un R15, la sede del cuscinetto ha bisogno della sua lunghezza) e offre delle opzioni; nulla
viene applicato.

## 3. Indica qualcosa e chiedi una modifica

- Nel visualizzatore 3D, Alt+clic sulla faccia superiore del mozzo. Nel campo della chat compare
  un’etichetta “Faccia … normale +Z”.
- Scrivi:

> Smussa lo spigolo esterno di questa faccia con 2 × 45° e porta l’altezza del mozzo a 35 mm.

Accetta. Poi nella scheda Modello seleziona i quattro fori M10 (selezione a finestra), fai clic su
**Usa selezione** e scrivi:

> Cambia questi in fori di passaggio per M12 e allarga l’interasse a 114 × 114.

Accetta; i fori, le loro quote e la funzione foro seguono.

## 4. Il disegno e il PDF

> Quota tutto secondo ISO 129-1 con gli accoppiamenti H7, aggiungi una vista frontale in sezione
> completa per l’asse del foro, metti tutto su un foglio A2 in scala 1:1 con il cartiglio compilato
> (titolo “Bearing housing”, materiale EN-GJL-250) ed esporta il PDF.

Accetta. Si apre la scheda del foglio, compare la finestra di salvataggio del PDF; salva e apri il
PDF.

## 5. Se qualcosa va storto

- La richiesta impossibile del passo 2 è il momento dell’onestà: l’assistente non finge; misura,
  spiega perché e chiede quale strada prendere.
- Nessuna risposta, o un errore di chiave: la scheda Assistente dice perché in parole semplici;
  controlla la chiave e il nome del modello.
- Una proposta che non ti piace: **Rifiuta**, oppure accetta e premi `U`.
- L’assistente non modifica mai in silenzio: cerca la scheda, nulla cambia senza Accetta.

## Sito web

La stessa dimostrazione è la pagina demo del sito (`/demo/`, `/it/demo/`): la registrazione dello
schermo di questo copione eseguito con il modello reale (`e2e/demo.e2e.ts`, poi
`scripts/demo-video.mjs`), con i passi sotto come capitoli.
