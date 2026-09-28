import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

test('model settings validate role-specific IDs and reject malformed values', async () => {
  const { modelSettingsSchema } = await import('../src/schema.js');
  const valid = { dreamer: 'vendor/creative-model', jev: 'jev-2.0', narrator: 'vendor/card-model:free' };
  assert.deepEqual(modelSettingsSchema.parse(valid), valid);
  assert.equal(modelSettingsSchema.safeParse({ ...valid, jev: '' }).success, false);
  assert.equal(modelSettingsSchema.safeParse({ ...valid, narrator: 'model with spaces' }).success, false);
  assert.equal(modelSettingsSchema.safeParse({ ...valid, extra: 'ignored' }).success, false);
});

test('existing settings tables receive model defaults without losing configured limits', async () => {
  const { migrateModelSettings } = await import('../src/db.js');
  const { DEFAULT_MODELS } = await import('../src/config.js');
  const database = new Database(':memory:');
  try {
    database.exec('CREATE TABLE settings (id INTEGER PRIMARY KEY, daily_expansion_cap INTEGER, daily_pin_cap INTEGER, hourly_spend_limit REAL); INSERT INTO settings VALUES (1, 17, 8, 3.5)');
    migrateModelSettings(database);
    migrateModelSettings(database);
    const row = database.prepare('SELECT * FROM settings WHERE id=1').get() as Record<string, unknown>;
    assert.equal(row.daily_expansion_cap, 17);
    assert.equal(row.daily_pin_cap, 8);
    assert.equal(row.hourly_spend_limit, 3.5);
    assert.equal(row.dreamer_model, DEFAULT_MODELS.dreamer);
    assert.equal(row.jev_model, DEFAULT_MODELS.jev);
    assert.equal(row.narrator_model, DEFAULT_MODELS.narrator);
  } finally { database.close(); }
});
