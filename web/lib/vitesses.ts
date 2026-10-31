// Calque « vitesse maximale nominale » (SNCF Réseau) : plages de couleur.

// 160 : grande vitesse sur ligne classique ; 220 : entrée et sortie de LGV ; 300 : pleine LGV. Du sombre à l'ambre vif.
export const VMAX_BANDS = [
  { from: 0, label: '< 100', color: '#4a4a4a' },
  { from: 100, label: '100–159', color: '#7a5a2a' },
  { from: 160, label: '160–219', color: '#b8860b' },
  { from: 220, label: '220–299', color: '#ffb000' },
  { from: 300, label: '≥ 300', color: '#fff1a8' },
] as const;

export function vmaxColorExpr(): unknown[] {
  return ['step', ['get', 'v'], VMAX_BANDS[0].color, ...VMAX_BANDS.slice(1).flatMap((b) => [b.from, b.color])];
}
