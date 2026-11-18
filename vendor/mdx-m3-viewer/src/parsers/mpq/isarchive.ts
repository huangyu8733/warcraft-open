/**
 * Search for the MPQ header - MPQ\x1A.
 * The header can be on any 512 bytes boundry offset.
 */
export function searchHeader(bytes: Uint8Array): number {
  for (let i = 0, l = Math.ceil(bytes.byteLength / 512); i < l; i++) {
    const base = i * 512;

    // Test 'MPQ\x1A'.
    if (bytes[base] === 77 && bytes[base + 1] === 80 && bytes[base + 2] === 81 && bytes[base + 3] === 26) {
      // OpenWar3 fix: return the FIRST header, not the last. WC3's main MPQs
      // (e.g. War3.mpq) embed maps whose own MPQ headers appear later in the
      // file; keeping the last match read an 18-file stub instead of the real
      // archive. Maps (HM3W at 0) still resolve to their MPQ header at 512.
      return base;
    }
  }

  return -1;
}

/**
 * Checks whether the given buffer is either a Warcraft 3 map or otherwise a generic MPQ archive.
 */
export function isArchive(bytes: Uint8Array): boolean {
  // Check for the map identifier - HM3W
  if (bytes[0] === 72 && bytes[1] === 77 && bytes[2] === 51 && bytes[3] === 87) {
    return true;
  }

  // Look for an MPQ header.
  return searchHeader(bytes) !== -1;
}
