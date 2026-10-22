<!--
Italian text of the demo page (/it/demo/), translated from docs/demo.md: same "## N." sections and
the same number of quoted prompts in each. "source" is the hash the build prints when docs/demo.md
changes; update it together with the translation.
source: 6f4ccac329
-->
# Copione della demo: progettare scrivendo, indicare, modificare, stampare

## 0. Prima della demo

- Avvia il programma (`npm run dev` o il programma installato), tema scuro, area di disegno bianca
  se il proiettore è molto luminoso (menu Visualizza).
- Scheda Assistente: fornitore Claude, modello Claude Opus 5.5, chiave salvata (“Chiave salvata” in
  verde).
- Chiudi ogni file aperto: File > Nuovo.

## 1. Una parte da una frase (2D)

Scrivi nella scheda Assistente:

> Una piastra di fissaggio 160 × 100 mm, raggi R12 agli angoli, quattro fori di passaggio per M8
> su un interasse di 130 × 70 e un foro Ø40 H7 al centro.

Che cosa mostrare: la scheda della proposta elenca che cosa aggiungerà, le affermazioni dicono da
dove viene ogni numero (Ø9 per M8 da `library/holes/iso-273`, serie media; H7 dalla ISO 286) e il
disegno mostra l’anteprima in trasparenza. Fai clic su **Accetta**. Premi `U` una volta per
mostrare che è un solo passo di annullamento, poi `REDO`.

## 2. Passo dopo passo fino alla parte 3D

> Rendila una parte 3D: estrudi il contorno di 12 mm e fai i fori passanti.

Accetta. Si apre la scheda 3D con il corpo; la scheda Funzioni mostra l’albero. Poi:

> Aggiungi sopra un mozzo Ø60 alto 25 mm attorno al foro, e un raccordo di 2 mm sugli spigoli del
> mozzo.

Accetta e ruota la vista. Poi una richiesta impossibile, per mostrare l’onestà:

> Raccorda tutti gli spigoli con 20 mm.

La proposta viene costruita in background e fallisce con parole semplici (“il raccordo di 20 mm non
sta nella piastra di 12 mm…”); non viene applicato nulla.

## 3. Indica qualcosa e chiedi una modifica

- Nel visualizzatore 3D, Alt+clic sulla faccia superiore del mozzo. Nel campo della chat compare un
  riferimento “Faccia … normale +Z”.
- Scrivi:

> Smussa lo spigolo esterno di questa faccia 1 × 45° e porta il mozzo a 30 mm di altezza.

Accetta. Poi nella scheda Modello 2D seleziona i quattro cerchi dei fori (selezione a finestra), fai
clic su **Usa selezione** e scrivi:

> Trasformali in fori di passaggio per M10 e sposta l’interasse a 136 × 76.

Accetta; i fori e la funzione foro seguono.

## 4. Il disegno e il PDF

> Quota la piastra secondo ISO 129-1 (contorno, interasse dei fori, foro con la tolleranza H7),
> mettila su un foglio A3 in scala 1:1 con il cartiglio compilato ed esporta il PDF.

Accetta. Si apre la scheda del foglio e compare la finestra per salvare il PDF; salva e apri il PDF.

## 5. Se qualcosa va storto

- Nessuna risposta, o un errore della chiave: la scheda Assistente dice il perché in parole
  semplici; controlla la chiave e il nome del modello.
- Una proposta che non ti piace: **Rifiuta**, oppure accetta e premi `U`.
- L’assistente non modifica mai di nascosto: cerca la scheda della proposta; niente cambia senza
  un clic su Accetta.
