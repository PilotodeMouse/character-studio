// Identifica o "rig" (esqueleto) de um personagem Craftpix e guarda o que
// aprendemos sobre ele entre sessoes.
//
// DUAS CAMADAS, DE PROPOSITO
// - Preferencias de BAKE (tamanho da celula, frames, view de costas) valem
//   pro esqueleto inteiro. Toda a serie Chibi da Craftpix compartilha o mesmo
//   rig-base (bone_000..bone_007, Body/Head/Arm/Hand/Leg/Face*) e sai no mesmo
//   formato de saida, entao herdar isso entre personagens e util.
// - Ajustes MANUAIS por peca (dx/dy/angulo/pivo/followBone) NAO valem. Sao
//   correcoes na arte de UM personagem: o bracoso Goblin nao esta no mesmo
//   lugar que o do Esqueleto, mesmo os dois pendurando no mesmo osso. Cada
//   personagem tem sua propria gaveta em `characters[nome]`, e copiar de um
//   pro outro so acontece se o usuario pedir explicitamente.
//
// POR QUE ESSA SEPARACAO EXISTE
// O formato v1 guardava `partOffsets` solto na raiz do arquivo, indexado so
// pela assinatura do esqueleto. Resultado: bastava ajustar UM personagem a
// mao pra que todos os outros da mesma serie fossem importados ja
// desmontados, cada peca deslocada pelo ajuste que era de outro. Pior: cada
// bake regravava aquilo, entao o estrago se propagava sozinho.
//
// MIGRACAO v1 -> v2: os partOffsets dos arquivos antigos sao DESCARTADOS de
// proposito. Eles foram gravados na epoca em que o desenho tinha o bug de
// pivo (cada peca subia a propria altura -- ver unity-skeleton.js), ou seja,
// sao compensacoes manuais daquele bug. Com o pivo corrigido, reaplicar
// aquilo desmonta o personagem em vez de consertar. As preferencias de bake
// do arquivo antigo, essas sim, sao aproveitadas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 2;

function computeRigFingerprint(rig) {
  const names = [...rig.bones.values()]
    .map((b) => `${b.name}<-${b.parentTransformId ? rig.bones.get(b.parentTransformId).name : ''}`)
    .sort();
  const signature = JSON.stringify(names);
  const rigId = crypto.createHash('sha1').update(signature).digest('hex').slice(0, 16);
  return { rigId, signature };
}

// Devolve sempre a forma v2, venha o arquivo de onde vier. `migratedFromV1`
// e `droppedPartOffsets` existem pra UI conseguir explicar ao usuario por que
// os ajustes antigos dele sumiram, em vez de simplesmente sumirem.
function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const bake = {
    size: raw.size,
    framesIdle: raw.framesIdle,
    framesWalk: raw.framesWalk,
    hasNorthView: raw.hasNorthView,
    rowCount: raw.rowCount, // undefined nos perfis anteriores as 4 direcoes
  };

  if (Number(raw.version) >= 2) {
    return {
      ...bake,
      version: SCHEMA_VERSION,
      characters: raw.characters && typeof raw.characters === 'object' ? raw.characters : {},
      migratedFromV1: false,
      droppedPartOffsets: 0,
    };
  }

  return {
    ...bake,
    version: SCHEMA_VERSION,
    characters: {},
    migratedFromV1: true,
    droppedPartOffsets: Object.keys(raw.partOffsets || {}).length,
  };
}

// Ajustes de um personagem em TODAS as quatro direcoes, venha o perfil do
// formato novo (partOffsetsByRow) ou do anterior, que so guardava EAST
// (partOffsets) e NORTH (partOffsetsNorth).
function characterOffsetsByRow(entry) {
  if (!entry) return { north: {}, east: {}, south: {}, west: {} };
  const byRow = entry.partOffsetsByRow || {};
  return {
    north: byRow.north || entry.partOffsetsNorth || {},
    east: byRow.east || entry.partOffsets || {},
    south: byRow.south || {},
    west: byRow.west || {},
  };
}

class RigProfileStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  _pathFor(rigId) {
    return path.join(this.dir, `${rigId}.json`);
  }

  // Perfil completo (ja normalizado pra v2), ou null se o rig e novo.
  read(rigId) {
    const p = this._pathFor(rigId);
    if (!fs.existsSync(p)) return null;
    try {
      return normalizeProfile(JSON.parse(fs.readFileSync(p, 'utf8')));
    } catch (err) {
      // Perfil corrompido nao pode impedir de abrir o personagem: e cache,
      // nao dado de origem. Trata como rig novo.
      return null;
    }
  }

  // Ajustes de UM personagem especifico ({} se ele ainda nao foi salvo).
  characterEntry(rigId, characterName) {
    const profile = this.read(rigId);
    if (!profile || !characterName) return null;
    return profile.characters[characterName] || null;
  }

  // Nomes dos outros personagens que ja tem ajuste salvo neste mesmo
  // esqueleto -- alimenta a oferta de "copiar os ajustes de X".
  otherCharacterNames(rigId, exceptName) {
    const profile = this.read(rigId);
    if (!profile) return [];
    return Object.keys(profile.characters).filter((n) => n !== exceptName);
  }

  // Grava preferencias de bake (nivel esqueleto) + ajustes do personagem
  // (nivel personagem) numa tacada so, preservando o que ja estava la para
  // os OUTROS personagens.
  saveForCharacter(rigId, characterName, { size, framesIdle, framesWalk, hasNorthView, rowCount, scale, offsetX, offsetY, partOffsetsByRow, rowModes }) {
    const current = this.read(rigId) || { characters: {} };
    const next = {
      version: SCHEMA_VERSION,
      size,
      framesIdle,
      framesWalk,
      hasNorthView,
      rowCount, // 2 (a Biblioteca espelha SOUTH/WEST) ou 4 (todas desenhadas)
      characters: { ...current.characters },
    };
    if (characterName) {
      const byRow = partOffsetsByRow || {};
      next.characters[characterName] = {
        scale,
        offsetX,
        offsetY,
        partOffsetsByRow: byRow,
        rowModes: rowModes || {},
        // Espelha as duas primeiras direcoes nas chaves antigas tambem, pra um
        // perfil gravado aqui continuar sendo lido por uma versao anterior do
        // app (e vice-versa -- ver characterOffsetsByRow).
        partOffsets: byRow.east || {},
        partOffsetsNorth: byRow.north || {},
      };
    }
    fs.writeFileSync(this._pathFor(rigId), JSON.stringify(next, null, 2));
    return next;
  }

  list() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => normalizeProfile(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'))));
  }
}

module.exports = { computeRigFingerprint, RigProfileStore, normalizeProfile, characterOffsetsByRow, SCHEMA_VERSION };
