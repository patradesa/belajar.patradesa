import type { MyCourse } from '@patradesa/shared';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';
import { MyCourseList } from '../components/MyLearning';

export function MyCoursesPage() {
  const { me, loading: sLoading } = useSession();
  const { data, error, loading, reload } = useAsync(() => (me ? api<{ courses: MyCourse[] }>('/me/courses') : Promise.resolve({ courses: [] })), [me?.user.id]);
  if (sLoading) return <Loading />;
  if (!me)
    return (
      <p>
        <Link href="/masuk">Masuk</Link> untuk melihat kelas Anda.
      </p>
    );
  return (
    <div className="stack">
      <PageTitle>Kelas Saya</PageTitle>
      {loading && !data && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      {data && <MyCourseList courses={data.courses} />}
    </div>
  );
}
