<!--
description: Metodo del primo diedro e del terzo diedro a confronto: dove va ogni vista rispetto alla vista frontale, il simbolo del metodo di proiezione, dove si usa l'uno o l'altro e come lo gestisce MechPilot.
-->
# Proiezione nel primo e nel terzo diedro

Un disegno di produzione mostra un pezzo in più viste ortogonali. Ogni vista guarda il pezzo lungo
una direzione, perpendicolare a un piano di proiezione. I due metodi descritti qui producono
esattamente le stesse viste; cambia solo **dove ogni vista viene collocata sul foglio**. Chi legge
con il metodo sbagliato vede il pezzo specchiato, perciò ogni disegno dichiara il metodo che usa.

I metodi sono definiti dalla **ISO 5456-2** (metodi di proiezione, rappresentazioni ortogonali). Le
convenzioni di base per le viste, come la scelta della vista principale, sono nella **ISO 128-30**.

## Prima di tutto la vista frontale

La vista più significativa del pezzo si disegna come vista frontale, detta anche vista principale.
Le altre viste si dispongono intorno, e solo quante ne servono per definire il pezzo in modo
completo e senza ambiguità.

## Metodo del primo diedro

Immagina il pezzo tra te e il piano di proiezione: ogni vista viene proiettata *attraverso* il pezzo
sul piano che sta dietro. Rispetto alla vista frontale:

- la vista dall'alto va **sotto**;
- la vista dal basso va **sopra**;
- la vista da sinistra va **a destra**;
- la vista da destra va **a sinistra**.

In Italia è detto anche metodo europeo.

## Metodo del terzo diedro

Immagina il piano di proiezione tra te e il pezzo, come se guardassi attraverso una finestra: ogni
vista si disegna sulla finestra, dalla tua parte. Rispetto alla vista frontale:

- la vista dall'alto va **sopra**;
- la vista dal basso va **sotto**;
- la vista da sinistra va **a sinistra**;
- la vista da destra va **a destra**.

In Italia è detto anche metodo americano.

[[FIG:projection-layout]]

## Il simbolo del metodo di proiezione

Poiché le viste da sole non mostrano il metodo, il disegno riporta un simbolo grafico definito
dalla ISO 5456-2: un tronco di cono rappresentato in due viste. Nel simbolo del primo diedro la
vista di testa (due cerchi) sta a destra della vista laterale; nel simbolo del terzo diedro sta a
sinistra. Il simbolo va vicino al cartiglio; la ISO 7200 non lo elenca tra i campi del cartiglio,
si riporta fuori dal riquadro quando serve ([cartiglio ISO 7200]({{P_TITLE_BLOCK}})).

[[FIG:projection-symbols]]

## Quale usare

Entrambi i metodi sono normati. Il primo diedro è la scelta abituale in gran parte d'Europa e in
molti altri paesi; il terzo diedro è la scelta abituale in Nord America, dove la ASME Y14.3 lo usa
come predefinito. Usa il metodo che si aspettano il tuo cliente o la tua azienda, riporta il suo
simbolo e non mescolare mai i due metodi nello stesso disegno.

Quando le posizioni abituali non vanno bene per un disegno, la ISO 5456-2 ammette anche il metodo
delle frecce di riferimento: ogni vista è identificata da una lettera e una freccia su un'altra
vista indica la direzione di osservazione, così le viste possono stare ovunque sul foglio.

## In MechPilot

Ogni disegno ha un'impostazione del metodo di proiezione: primo diedro di default, terzo diedro come
opzione (nel pannello Proprietà senza nulla selezionato; nel file è salvata come
`"projection": "first"` o `"third"`). Le viste frontale, dall'alto, laterale e isometrica generate
dalle parti 3D, disposte secondo quell'impostazione, fanno parte del traguardo M5.

Vedi anche: [gli accoppiamenti ISO spiegati]({{P_GUIDE_FITS}}).
