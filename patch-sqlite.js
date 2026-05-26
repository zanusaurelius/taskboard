'use strict';
// Loaded via node --require so that every new Database(path) call in this
// process — including inside @prisma/adapter-better-sqlite3 — automatically
// applies the encryption key stored in globalThis.__dbKey before any SQL runs.

const fs   = require('fs');
const path = require('path');

console.error('[patch-sqlite] loading, __dirname =', __dirname);

// Creates an EncryptedDatabase subclass that auto-applies globalThis.__dbKey.
function makeEncryptedDatabase(OriginalDatabase) {
  const Enc = class EncryptedDatabase extends OriginalDatabase {
    constructor(filename, options) {
      super(filename, options);
      const key = globalThis.__dbKey;
      console.error('[patch-sqlite] new Database:', filename, '| key set:', !!key);
      if (key && filename !== ':memory:') {
        try {
          this.key(Buffer.from(key, 'hex'));
          console.error('[patch-sqlite] key applied OK');
        } catch (e) {
          console.error('[patch-sqlite] key() threw:', e && e.message);
          throw e;
        }
      }
    }
  };
  Object.assign(Enc, OriginalDatabase);
  return Enc;
}

function patchPackage(packagePath) {
  try {
    const Original  = require(packagePath);
    const Encrypted = makeEncryptedDatabase(Original);
    const resolved  = require.resolve(packagePath);
    const cached    = require.cache[resolved];
    if (cached) {
      cached.exports = Encrypted;
      console.error('[patch-sqlite] patched', resolved);
    } else {
      console.error('[patch-sqlite] WARNING: no cache entry for', resolved);
    }
  } catch (e) {
    console.error('[patch-sqlite] patchPackage failed for', packagePath, ':', e && e.message);
  }
}

// 1. Patch the standard 'better-sqlite3' path.
patchPackage('better-sqlite3');

// 2. Patch every Turbopack-hashed copy under .next/node_modules/.
const nextNodeModules = path.join(__dirname, '.next', 'node_modules');
console.error('[patch-sqlite] scanning', nextNodeModules, 'exists:', fs.existsSync(nextNodeModules));
if (fs.existsSync(nextNodeModules)) {
  try {
    for (const dir of fs.readdirSync(nextNodeModules)) {
      if (dir === 'better-sqlite3' || dir.startsWith('better-sqlite3-')) {
        patchPackage(path.join(nextNodeModules, dir));
      }
    }
  } catch (e) {
    console.error('[patch-sqlite] scan error:', e && e.message);
  }
}

// 3. Force the CJS adapter to load NOW so its module-level import captures
//    the patched Database class.
try {
  require('@prisma/adapter-better-sqlite3');
  console.error('[patch-sqlite] CJS adapter pre-loaded OK');
} catch (e) {
  console.error('[patch-sqlite] CJS adapter pre-load skipped:', e && e.message);
}

console.error('[patch-sqlite] done');
