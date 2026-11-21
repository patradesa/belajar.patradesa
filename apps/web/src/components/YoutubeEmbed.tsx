import { useState } from 'react';

/** Video dimuat HANYA setelah klik (hemat data & privasi). Domain privacy-enhanced youtube-nocookie. */
export default function YoutubeEmbed({ videoId, title }: { videoId: string; title: string }) {
  const [play, setPlay] = useState(false);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  if (!play) {
    return (
      <div className="video-placeholder">
        <p style={{ margin: 0 }}>
          Video dari YouTube. Memutar video memakai kuota data dan dapat menyetel cookie YouTube.
        </p>
        <button type="button" className="btn" onClick={() => setPlay(true)}>
          ▶ Tonton video
        </button>
      </div>
    );
  }
  return (
    <iframe
      className="video-frame"
      src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
      title={`Video: ${title}`}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
