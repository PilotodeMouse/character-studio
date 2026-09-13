// Extrai um .unitypackage (gzip+tar de pastas <guid>/{asset,asset.meta,pathname})
// e devolve um indice utilizavel: guid -> pathname, e acesso ao texto de
// qualquer "asset" por guid.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const tar = require('tar');

async function extractUnityPackage(unitypackagePath) {
  const destDir = path.join(
    os.tmpdir(),
    'isometric-character-studio',
    crypto.createHash('sha1').update(unitypackagePath).digest('hex').slice(0, 16)
  );
  fs.mkdirSync(destDir, { recursive: true });
  await tar.x({ file: unitypackagePath, cwd: destDir });

  const guidToPathname = new Map();
  const guidDirs = fs.readdirSync(destDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const dir of guidDirs) {
    const pathnameFile = path.join(destDir, dir.name, 'pathname');
    if (!fs.existsSync(pathnameFile)) continue;
    const pathname = fs.readFileSync(pathnameFile, 'utf8').split(/\r?\n/)[0].trim();
    guidToPathname.set(dir.name, pathname);
  }

  function readAsset(guid) {
    const p = path.join(destDir, guid, 'asset');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }

  function findGuidByPathnameSuffix(suffix) {
    for (const [guid, pathname] of guidToPathname) {
      if (pathname.endsWith(suffix)) return guid;
    }
    return null;
  }

  return { destDir, guidToPathname, readAsset, findGuidByPathnameSuffix };
}

module.exports = { extractUnityPackage };
