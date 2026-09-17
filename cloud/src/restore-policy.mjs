// Run only against a restored database before it is attached to a serving worker.
// Backups can predate a deletion or key revocation. Sacrifice historical reports
// rather than restore access to data the customer already deleted.
export async function quarantineRestoredDatabase(db) {
  await db.batch([
    db.prepare('UPDATE tenants SET disabled = 1'),
    db.prepare("UPDATE runs SET status = 'deleted', cancel_requested = 1, report = NULL, screenshot = NULL"),
  ]);
}
