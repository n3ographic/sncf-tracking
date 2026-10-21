import TableauView from './tableau-view';

export const metadata = { title: 'Tableau de bord · Observatoire TGV' };

export default function Page() {
  return (
    <main className="tb">
      <TableauView />
    </main>
  );
}
