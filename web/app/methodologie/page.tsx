import { supabaseDeps } from '../../lib/supabase';
import { loadRules, type Rules } from '../../lib/rules';
import FootBar from '../terminal/foot-bar';
import StatusBar from '../terminal/status-bar';

export const metadata = { title: 'Méthodologie · Observatoire TGV' };
// Rendue à chaque requête : un build sans accès à la base ne doit pas figer « règles indisponibles ».
// La base n'est lue qu'une fois par heure (cache de données de loadRules).
export const dynamic = 'force-dynamic';

const nf = (n: number) => n.toLocaleString('fr-FR');
const fmtMin = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${nf(m)} min`);
// 5 400 s = 1 h 30 ; 10 801 s = « plus de 3 h » (la base stocke un seuil exclusif à la seconde près).
function fmtDuration(s: number): string {
  if (s % 60 === 1) return `plus de ${fmtDuration(s - 1)}`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
// Tranche de durée prévue : le seuil suivant (exclusif à la seconde près) borne la tranche.
function durationBand(from: number[], i: number): string {
  if (from.length === 1) return 'toutes durées';
  if (i === 0) return `moins de ${fmtDuration(from[1])}`;
  if (i === from.length - 1) return `plus de ${fmtDuration(from[i] - 1)}`;
  return `de ${fmtDuration(from[i])} à ${fmtDuration(from[i + 1] - 1)}`;
}
const RELEASES = 'https://github.com/n3ographic/sncf-tracking/releases';
const REPO = 'https://github.com/n3ographic/sncf-tracking';

function Unavailable() {
  return <p className="mt-warn" role="status">Règles indisponibles pour le moment, réessayez plus tard.</p>;
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} rel="noopener noreferrer">{children}</a>;
}

export default async function Page() {
  let rules: Rules | null = null;
  try {
    rules = await loadRules(supabaseDeps);
  } catch (e) {
    console.error(e);
  }
  const brands = rules ? [...new Set(rules.compensation_scale.map((s) => s.brand))] : [];

  return (
    <>
    <StatusBar />
    <main className="mt">
      <h1 className="term-h1">Méthodologie</h1>

      <section>
        <h2>Sources et licence</h2>
        <ul>
          <li>Flux GTFS temps réel de la SNCF (Trip Updates et Service Alertes), via <Link href="https://transport.data.gouv.fr">transport.data.gouv.fr</Link>.</li>
          <li>GTFS statique SNCF (SNCF Open Data) pour les horaires théoriques.</li>
          <li>Fichier de formes des lignes du Réseau Ferré National, SNCF Réseau, pour les tracés de la carte. Pour les paires d'arrêts que ce fichier ne couvre pas (gares étrangères, interconnexion de Marne-la-Vallée, quelques lignes régionales), tracés de <Link href="https://trainnomade.fr/donnees/">Train Nomade</Link>, d'après © contributeurs OpenStreetMap.</li>
          <li><Link href="https://www.data.gouv.fr/datasets/regularite-mensuelle-tgv-par-liaisons">Régularité mensuelle TGV par liaisons</Link> (SNCF, data.gouv.fr) pour la définition de la régularité officielle.</li>
        </ul>
        <p>Ces données sont sous licence ODbL 1.0. Contient des informations de SNCF Open Data, de SNCF Réseau, de Train Nomade, des contributeurs OpenStreetMap et de transport.data.gouv.fr, sous licence ODbL.
          Observatoire indépendant, non affilié à SNCF ni à OUIGO.</p>
      </section>

      <section>
        <h2>Périmètre</h2>
        <p>Les TGV INOUI et les OUIGO TGV. Les OUIGO Train Classique (numéros 4000 à 4999) sont exclus.
          Seuls les trains que le flux temps réel publie sont mesurés : la collecte tourne toutes les 2 minutes depuis le 20 octobre 2026.</p>
      </section>

      <section>
        <h2>Définitions</h2>
        <dl>
          <dt>Prévu</dt><dd>Train du plan de transport (GTFS statique) pour un jour de service.</dd>
          <dt>Observé / jamais observé</dt><dd>Observé : le train est apparu dans le flux temps réel. Jamais observé : prévu mais jamais vu (collecte absente ou train non publié).</dd>
          <dt>Retiré tard, annulé</dt><dd>Retiré tard : retiré du plan après avoir été prévu. Annulé : suppression publiée dans le flux.</dd>
          <dt>Sans terminus</dt><dd>Train observé dont le retard au terminus n’est pas connu.</dd>
          <dt>Ayant circulé</dt><dd>Train observé, non annulé, dont le retard au terminus est connu. C’est l’effectif de tous les pourcentages.</dd>
        </dl>
        <h3>Régularité officielle</h3>
        <p>Un train est à l’heure si son retard au terminus est <strong>strictement inférieur</strong> à un seuil qui dépend de la durée prévue du trajet.
          Taux = trains à l’heure / trains ayant circulé ; les suppressions sont exclues du dénominateur, comme dans la mesure officielle.</p>
        {rules ? (
          <div className="mt-scroll">
            <table>
              <caption>Seuils de régularité (lus dans la base)</caption>
              <thead><tr><th scope="col">Durée prévue</th><th scope="col">Retard toléré (strictement inférieur à)</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {rules.regularity_rule.map((r, i, all) => (
                  <tr key={r.duration_from_s}>
                    <th scope="row">{durationBand(all.map((x) => x.duration_from_s), i)}</th>
                    <td>{fmtMin(r.max_delay_exclusive_s / 60)}</td>
                    <td><Link href={r.source_url}>source</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Unavailable />}
        <h3>Mesure brute</h3>
        <p>Les suppressions comptent comme des échecs. Le retard est réparti en huit tranches (0, 1-4, 5-14, 15-29, 30-59, 60-119, 120-179, 180 min et plus), au terminus et à chaque arrêt ; les arrêts supprimés sont comptés à part.
          Les tranches s’alignent sur les seuils d’indemnisation.</p>
      </section>

      <section>
        <h2>Indemnités théoriques</h2>
        <p>Pourcentage du billet dû selon le retard à l’arrivée, appliqué à un prix de référence et à un nombre de voyageurs estimé :
          coût = pourcentage × prix de référence × places × occupation.</p>
        {rules ? (
          <>
            {brands.map((b) => (
              <div className="mt-scroll" key={b}>
                <table>
                  <caption>Barème {b} (lu dans la base)</caption>
                  <thead><tr><th scope="col">Retard à l’arrivée</th><th scope="col">Part du billet</th><th scope="col">Source</th></tr></thead>
                  <tbody>
                    {rules.compensation_scale.filter((s) => s.brand === b).map((s) => (
                      <tr key={s.from_s}>
                        <th scope="row">dès {fmtDuration(s.from_s)} ({nf(s.from_s)} s)</th>
                        <td>{s.pct} %</td>
                        <td><Link href={s.source_url}>source</Link> (mise à jour le {s.source_as_of})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="mt-scroll">
              <table>
                <caption>Prix de référence et places (lus dans la base)</caption>
                <thead><tr><th scope="col">Marque</th><th scope="col">Prix moyen HT</th><th scope="col">Places d’une rame</th><th scope="col">Sources</th></tr></thead>
                <tbody>
                  {rules.reference_prices.map((p) => (
                    <tr key={p.brand}>
                      <th scope="row">{p.brand}</th>
                      <td>{nf(p.price_eur_ht)} € ({p.as_of.slice(0, 4)})</td>
                      <td>{nf(p.seats)}</td>
                      <td><Link href={p.price_source.split(' ')[0]}>prix</Link>, <Link href={p.seats_source.split(' ')[0]}>places</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <Unavailable />}
        <h3>Compteur cumulé</h3>
        <p>Le compteur de la carte et du tableau de bord additionne les indemnités théoriques depuis le 20 octobre 2026, jour par jour : chaque jour de service terminé est enregistré une fois, puis recalculé le lendemain pour rattraper les trains terminés tard.
          Il ne compte que les trains <strong>observés</strong> dans le flux temps réel et n’extrapole jamais aux trains non observés : il sous-estime donc la réalité tant que la couverture (part des trains prévus effectivement observés) est faible. La couverture est toujours affichée à côté du chiffre.</p>
        <p><strong>Hypothèses.</strong> Une seule rame est comptée (les rames couplées ne sont pas connues) : c’est un plancher. L’occupation de référence est de 0,75 : l’Autorité de régulation des transports donne 76 à 77 % pour l’ensemble des TGV en 2023 (<a href="https://www.voyages-d-affaires.com/attrait-transport-ferroviaire-france">rapport annuel, repris par la presse</a>).
          <strong> C’est une moyenne tous TGV, sans détail par marque ni par train</strong> ; le coût est proportionnel à l’occupation, <code>/api/stats</code> fournit aussi le coût à rames pleines.</p>
        <h3>Fourchette</h3>
        <p>Le flux publie les retards par pas de 5 minutes : le retard réel est à moins de 4 min 59 s du retard publié, et le sens de l’arrondi est inconnu. Les montants sont donc donnés avec une fourchette.
          Le montant <strong>central</strong> utilise le retard publié. La borne <strong>haute</strong> ajoute 4 min 59 s à chaque retard (un train publié à 30 minutes dépasse alors le seuil de 31 minutes).
          La borne <strong>basse</strong> retire 4 min 59 s et exclut aussi les trains qui sautent un arrêt intermédiaire, dont le retard au terminus reste compté au centre et en haut.
          L’occupation reste à 0,75 dans les trois cas : la fourchette traduit l’incertitude de mesure, pas celle du prix, des places et de l’occupation.</p>
        <h3>Retards aberrants</h3>
        <p>Un retard au terminus d’au moins 12 heures est écarté des mesures (régularité, tranches de retard, indemnités) et compté à part (métrique <code>aberrant</code>) : un TGV n’a pas 12 heures de retard, il s’agit d’une erreur de donnée.</p>
      </section>

      <section>
        <h2>Positions sur la carte</h2>
        <p>Les positions sont <strong>estimées</strong>, pas mesurées : chaque arrêt a son horaire prévu corrigé de son retard (publié, ou repris de l’arrêt précédent) ; le train reste à quai jusqu’à son départ corrigé puis avance jusqu’à l’arrivée corrigée de l’arrêt suivant,
          le long du tracé des voies lorsqu’il est connu et en ligne droite sinon. Un train dont le dernier passage du collecteur date de plus de 10 minutes est estompé (« donnée périmée »).</p>
      </section>

      <section>
        <h2>Limites connues</h2>
        <ul>
          <li>La collecte a commencé le 20 octobre 2026 : les premières périodes sont incomplètes (beaucoup de trains « jamais observés »).</li>
          <li>Les retards du flux vont par pas de 5 minutes (aucun retard publié entre 1 et 4 minutes). « À l’heure » équivaut à un retard publié de 0 ; la régularité calculée est une approximation de la régularité officielle, à calibrer avant toute comparaison. Les indemnités en dépendent aux seuils de 30 minutes et de 3 heures : d’où la fourchette.</li>
          <li>Les trains absents du plan du jour ne sont pas collectés.</li>
          <li>Les chiffres reposant sur moins de 30 trains ayant circulé sont estompés : ils ne permettent pas de conclure.</li>
          <li>Les causes de retard ne sont pas encore agrégées.</li>
          <li>Quelques gares n’ont pas de tracé (hors réseau du jeu de formes) : les trains y avancent en ligne droite.</li>
        </ul>
      </section>

      <section>
        <h2>Téléchargements</h2>
        <ul>
          <li><Link href="/api/rules">Règles en JSON</Link> (barèmes, seuils de régularité, prix de référence) : <code>/api/rules</code>.</li>
          <li>Journal mensuel des événements en CSV gzip, sous licence ODbL : <Link href={RELEASES}>Releases GitHub</Link>, tag <code>events-AAAA-MM</code>. Le premier export est prévu début novembre 2026.</li>
          <li>Code et données de l’observatoire : <Link href={REPO}>dépôt GitHub</Link>.</li>
        </ul>
      </section>
    </main>
    <FootBar />
    </>
  );
}
