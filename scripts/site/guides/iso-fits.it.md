<!--
description: Che cosa significano H7, g6 e H7/g6: classi di tolleranza ISO 286, gradi di tolleranza normalizzati, scostamenti fondamentali, accoppiamenti con gioco, incerti e con interferenza, con un esempio.
-->
# Gli accoppiamenti ISO spiegati

Un albero che deve girare libero in un foro, una spina che deve restare ferma dopo il
piantaggio, una sede di cuscinetto che deve centrare senza gioco: sono tutti *accoppiamenti* tra
un foro e un albero. La ISO 286 dà loro un codice comune, così "⌀25 H7/g6" significa la stessa cosa
in ogni ufficio tecnico e in ogni officina.

## Le due parti della ISO 286

- La **ISO 286-1** definisce il sistema: gradi di tolleranza normalizzati, scostamenti
  fondamentali e come si combinano in classi di tolleranza e accoppiamenti.
- La **ISO 286-2** riporta in tabella gli scostamenti limite delle classi di tolleranza per fori e
  alberi.

## Una classe di tolleranza è una lettera e un numero

Una classe di tolleranza come **H7** o **g6** ha due parti:

- La **lettera** è lo *scostamento fondamentale*: dove si trova la zona di tolleranza rispetto
  alla dimensione nominale. Le lettere maiuscole sono per i fori (elementi interni), le minuscole
  per gli alberi (elementi esterni).
- Il **numero** è il *grado di tolleranza normalizzato*: quanto è larga la zona. La ISO 286
  definisce {{GRADES}} gradi, da IT01 e IT0 a IT18; un numero più alto significa una zona più
  larga.

La larghezza dipende anche dalla dimensione: lo stesso grado concede di più su un pezzo più
grande. IT7 vale {{IT7_25}} µm per le dimensioni nominali oltre {{S25_OVER}} fino a
{{S25_UPTO}} mm, e {{IT7_100}} µm oltre {{S100_OVER}} fino a {{S100_UPTO}} mm. Tutti i valori:
[gradi di tolleranza normalizzati ISO 286]({{P_GRADES}}).

## Dove si trova la zona

- Foro **H**: lo scostamento inferiore EI è zero, quindi la zona parte dalla dimensione nominale e
  sale.
- Albero **h**: lo scostamento superiore es è zero, quindi la zona finisce alla dimensione nominale
  e scende.
- Gli alberi **da a a g** stanno sotto la dimensione nominale, gli alberi **da k a zc** sopra; i
  fori **da A a G** stanno sopra. Più la lettera è lontana da h (o H), più la zona è lontana dalla
  dimensione nominale.
- **js** e **JS** sono simmetrici rispetto alla dimensione nominale: più e meno metà della
  tolleranza.

ES ed EI maiuscoli sono gli scostamenti superiore e inferiore di un foro; es ed ei minuscoli quelli
di un albero.

## Foro e albero insieme: l'accoppiamento

Una classe del foro e una dell'albero con la stessa dimensione nominale formano un accoppiamento,
che si scrive con il foro per primo: **H7/g6**. A seconda di dove stanno le due zone,
l'accoppiamento è:

- **con gioco**: c'è sempre gioco; il foro più piccolo è almeno grande quanto l'albero più grande;
- **con interferenza**: c'è sempre interferenza; il foro più grande è al massimo grande quanto
  l'albero più piccolo;
- **incerto**: gioco o interferenza, a seconda delle dimensioni effettive dei pezzi.

La maggior parte degli accoppiamenti si sceglie nel **sistema foro base**: ogni foro è H e la
lettera dell'albero sceglie l'accoppiamento. Il **sistema albero base** fa il contrario, con ogni
albero h. Il foro base è spesso preferito perché un foro è più difficile da realizzare in molte
dimensioni diverse di un albero; tenerlo in H riduce il numero di alesatori e di calibri a tampone.

## Esempio: ⌀25 H7/g6

A 25 mm (l'intervallo dimensionale oltre {{S25_OVER}} fino a {{S25_UPTO}} mm):

- Foro **25 H7**: EI = {{H7_EI}} µm, ES = {{H7_ES}} µm, quindi il foro misura da {{H7_MIN}} a
  {{H7_MAX}} mm.
- Albero **25 g6**: es = {{G6_ES}} µm, ei = {{G6_EI}} µm, quindi l'albero misura da {{G6_MIN}} a
  {{G6_MAX}} mm.
- Il gioco è compreso tra {{CL_MIN}} µm (foro minimo, albero massimo) e {{CL_MAX}} µm (foro
  massimo, albero minimo): un accoppiamento con gioco.

La stessa tabella per ogni intervallo dimensionale: [H7/g6]({{P_FIT_H7G6}}). Altri accoppiamenti
comuni: [accoppiamenti ISO 286]({{P_FITS}}).

## Sul disegno

- Sul disegno di un particolare la classe segue la dimensione: **25 H7** sul foro, **25 g6**
  sull'albero. Gli scostamenti non vanno scritti accanto alla classe se non servono (vedi
  [quotatura ISO 129-1]({{P_DIMS}})).
- Sul disegno di un assieme l'accoppiamento si scrive con la classe del foro per prima:
  **25 H7/g6**.
- Limiti e accoppiamenti si riferiscono alla temperatura di riferimento normalizzata di 20 °C.

## In MechPilot

Assegna a una quota una classe di tolleranza come H7 nel pannello Proprietà: MechPilot scrive la
classe e ne prende gli scostamenti dai suoi dati ISO 286 (`library/fits/iso-286.json`, che cita la
ISO 286-1 e la ISO 286-2 e dice come è stato verificato ogni valore). Una classe che non è in quei
dati viene segnalata come tale; non viene mai indovinata.
