// Numérote les requêtes : seule la dernière lancée écrit l'état, une réponse arrivée trop tard est ignorée.
export function latest(): () => () => boolean {
  let n = 0;
  return () => {
    const mine = ++n;
    return () => mine === n;
  };
}
