/**
 * The file to offer for a Home post after a profile video upload, or null.
 * Only a highlight the owner made public: a video limited to clubs and
 * coaches, or a full match, is never suggested for Home.
 */
export function shareableVideo(info: { file: File; kind: string; visibility: string }): File | null {
  return info.kind === 'highlight' && info.visibility === 'public' ? info.file : null
}
