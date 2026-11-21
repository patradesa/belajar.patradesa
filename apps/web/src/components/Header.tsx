import { Link, navigate } from '../lib/router';
import { hasRole, useSession } from '../lib/session';
import { FontScaleControl } from './FontScaleControl';

export function Header() {
  const { me, logout } = useSession();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand">
          PatraDesa <span>Belajar</span>
        </Link>
        <nav aria-label="Navigasi utama">
          <ul className="nav">
            <li>
              <Link href="/">Katalog</Link>
            </li>
            {me && (
              <li>
                <Link href="/kelas-saya">Kelas Saya</Link>
              </li>
            )}
            {me && hasRole(me, 'admin', 'content_editor', 'mentor') && (
              <li>
                <Link href="/admin">Admin</Link>
              </li>
            )}
            {me ? (
              <>
                <li>
                  <Link href="/profil">Profil</Link>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      void logout().then(() => navigate('/'));
                    }}
                  >
                    Keluar
                  </button>
                </li>
              </>
            ) : (
              <li>
                <Link href="/masuk">Masuk</Link>
              </li>
            )}
          </ul>
        </nav>
        <FontScaleControl id="header-font" />
      </div>
    </header>
  );
}
