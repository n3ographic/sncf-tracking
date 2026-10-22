import FootBar from '../terminal/foot-bar';
import StatusBar from '../terminal/status-bar';
import TableauView from './tableau-view';

export const metadata = { title: 'Tableau de bord · Observatoire TGV' };

export default function Page() {
  return (
    <>
      <StatusBar />
      <main className="tb">
        <TableauView />
      </main>
      <FootBar />
    </>
  );
}
