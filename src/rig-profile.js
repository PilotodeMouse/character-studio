// Identifica o "rig" (esqueleto) de um personagem Craftpix e guarda/recupera
// as preferencias de bake associadas a ele (tamanho de celula, quantidade de
// frames), para que outros personagens com o MESMO esqueleto (toda a serie
// Chibi da Craftpix usa o mesmo rig-base: bone_000..bone_007, Body/Head/
// Left-Right Arm/Hand/Leg/Sword/Face*) herdem automaticamente essas
// escolhas ao serem importados.
//
// O mapeamento de NOME de animacao (Idle/Walking -> idle/walk do VTT) ja e
// universal para a serie inteira (ver craftpix-profile.js) e nao depende
// deste fingerprint -- ele so cobre preferencias de bake (tamanho/frames).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeRigFingerprint(rig) {
  const names = [...rig.bones.values()]
    .map((b) => `${b.name}<-${b.parentTransformId ? rig.bones.get(b.parentTransformId).name : ''}`)
    .sort();
  const signature = JSON.stringify(names);
  const rigId = crypto.createHash('sha1').update(signature).digest('hex').slice(0, 16);
  return { rigId, signature };
}

class RigProfileStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  _pathFor(rigId) {
    return path.join(this.dir, `${rigId}.json`);
  }

  get(rigId) {
    const p = this._pathFor(rigId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  save(rigId, profile) {
    fs.writeFileSync(this._pathFor(rigId), JSON.stringify(profile, null, 2));
  }

  list() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')));
  }
}

module.exports = { computeRigFingerprint, RigProfileStore };
