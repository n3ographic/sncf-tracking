import CarteView from './carte-view';

export default function Home() {
  return (
    <main>
      <h1 className="sr-only">Observatoire TGV : carte des trains en circulation</h1>
      <CarteView />
    </main>
  );
}
