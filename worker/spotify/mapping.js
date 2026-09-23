function pickArt(images, size) {
  const list = images || [];
  return (list.find((i) => i.width === size) || (size <= 64 ? list[list.length - 1] : list[1]) || list[0] || {}).url || null;
}

/* The badge renders this as a link, so only a Spotify web address gets through. */
function spotifyLink(url) {
  return typeof url === 'string' && url.startsWith('https://open.spotify.com/') ? url : null;
}

export function compactTrack(item, progressMs, artSize = 300) {
  if (!item) return null;
  const art = pickArt(item.album?.images, artSize);
  return {
    uri: item.uri || null,
    title: item.name || '',
    artists: (item.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    album: item.album?.name || '',
    art,
    url: spotifyLink(item.external_urls?.spotify),
    durationMs: Number(item.duration_ms) || 0,
    progressMs: Number(progressMs) || 0,
  };
}

export function compactAlbum(a) {
  return {
    uri: a.uri, id: a.id, name: a.name || '',
    artists: (a.artists || []).map((x) => x.name).filter(Boolean).join(', '),
    art: pickArt(a.images, 64), count: Number(a.total_tracks) || 0,
  };
}

export function compactArtist(a) {
  return { uri: a.uri, id: a.id, name: a.name || '', art: pickArt(a.images, 64) };
}

export function compactPlaylist(p) {
  return {
    uri: p.uri, id: p.id, name: p.name || '',
    owner: p.owner?.display_name || '', ownerId: p.owner?.id || null, collaborative: !!p.collaborative,
    /* `tracks` before February 2026; neither for a playlist the user does not own, so unknown */
    art: pickArt(p.images, 64), count: typeof (p.items || p.tracks)?.total === 'number' ? (p.items || p.tracks).total : null,
  };
}

export function nextPageOffset(body, offset) {
  if (!body.next) return null;
  try {
    const next = Number(new URL(body.next).searchParams.get('offset'));
    if (Number.isSafeInteger(next) && next > offset) return next;
  } catch {}
  const next = offset + (body.items?.length || 0);
  return next > offset ? next : null;
}

export const page = (body, offset, mapped) => {
  // Advance by upstream entries, including null/local/unplayable items we filtered out.
  const nextOffset = nextPageOffset(body, offset);
  return { items: mapped, total: Number(body.total) || mapped.length, next: nextOffset !== null, nextOffset, offset };
};

