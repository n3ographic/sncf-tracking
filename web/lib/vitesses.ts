// Calque « vitesse maximale nominale » (SNCF Réseau) : plages de couleur.

// 160 : grande vitesse sur ligne classique ; 220 : entrée et sortie de LGV ; 300 : pleine LGV.
// Rampe ordinale bleue (une teinte, du sombre au clair sur fond sombre) : distincte de l'ambre des voies et des
// couleurs de retard des trains. Validée sur le fond de la carte (#0c0c0c) : clarté croissante, écarts visibles,
// la plage la plus lente reste au-dessus de 2:1.
export const VMAX_BANDS = [
  { from: 0, label: '< 100', color: '#184f95' },
  { from: 100, label: '100–159', color: '#2a78d6' },
  { from: 160, label: '160–219', color: '#5598e7' },
  { from: 220, label: '220–299', color: '#86b6ef' },
  { from: 300, label: '≥ 300', color: '#cde2fb' },
] as const;

export function vmaxColorExpr(): unknown[] {
  return ['step', ['get', 'v'], VMAX_BANDS[0].color, ...VMAX_BANDS.slice(1).flatMap((b) => [b.from, b.color])];
}
