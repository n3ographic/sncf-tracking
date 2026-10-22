import { permanentRedirect } from 'next/navigation';

// Les statistiques du tableau de bord sont sur l'écran d'accueil.
export default function Page() {
  permanentRedirect('/');
}
