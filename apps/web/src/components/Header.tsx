import { useEffect, useState } from 'react';
import { Link, navigate, useLocation } from '../lib/router';
import { hasRole, useSession } from '../lib/session';
import { Icon } from './Icon';

export function Header() {
  const { me, logout } = useSession();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);

  // Tutup menu ponsel setiap pindah halaman.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <img className="brand-logo" src="/logo-patradesa.png" alt="Patra Desa" width={197} height={48} decoding="async" /> <span className="brand-tag">Belajar</span>
        </Link>
        <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="menu-utama" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? 'close' : 'menu'} />
          Menu
        </button>
        <nav id="menu-utama" className="main-nav" aria-label="Navigasi utama" data-open={open}>
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
                <Link href="/admin" aria-current={path.startsWith('/admin') ? 'page' : undefined}>
                  Admin
                </Link>
              </li>
            )}
            {!me && (
              <li className="nav-mobile-only">
                <Link href="/masuk">Masuk</Link>
              </li>
            )}
            {me && (
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
            )}
          </ul>
        </nav>
        <div className="header-tools">
          {!me && (
            <Link href="/masuk" className="btn btn-accent header-cta">
              <Icon name="login" />
              Mulai belajar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
