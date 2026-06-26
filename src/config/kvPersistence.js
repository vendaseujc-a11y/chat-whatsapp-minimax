// kvPersistence.js – DEPRECATED
// This module is no longer used. The application now uses Supabase directly.
// Kept for backwards compatibility only.

async function saveToKv() { /* no-op */ }
async function loadFromKv() { return null; }

module.exports = {
  saveToKv,
  loadFromKv,
  TENANTS_KEY: 'tenants',
  PRODUCTS_KEY: 'products'
};
