/** A dismissed announcement stays dismissed until its text (and so its id) changes. */
export function announcementVisible(id: string | null, text: string | null, dismissedId: string | null): boolean {
  return Boolean(id && text && id !== dismissedId);
}
