// Rig semantico compartilhado por TODOS os personagens-template (SVG
// proprios, sem Unity/scml). Ao contrario do rig extraido do Unity, aqui
// bones nao "apontam" em nenhuma direcao especial -- um bone e so um ponto
// de ancoragem (x,y) + angulo, num espaco Y-para-cima com origem no chao
// (mesma convencao de ancoragem do VTT: body-axis-x/ground-line-y).
//
// A pose de bind (parada, de pe) e um ponto de partida razoavel; o que
// importa e o CONTRATO de nomes -- as animacoes-template (motion-templates.js)
// e o binding de cada personagem (character-binding.js) sao escritos contra
// esses mesmos nomes.
const HUMANOID_MEDIUM = {
  archetype: 'humanoid-medium',
  bones: [
    { name: 'root', parent: null, bind: { x: 0, y: 0, angle: 0 } },
    { name: 'torso', parent: 'root', bind: { x: 0, y: 90, angle: 0 } },
    { name: 'head', parent: 'torso', bind: { x: 0, y: 70, angle: 0 } },
    { name: 'arm-main', parent: 'torso', bind: { x: -34, y: 24, angle: 0 } },
    { name: 'arm-off', parent: 'torso', bind: { x: 34, y: 24, angle: 0 } },
    { name: 'leg-left', parent: 'root', bind: { x: -18, y: 0, angle: 0 } },
    { name: 'leg-right', parent: 'root', bind: { x: 18, y: 0, angle: 0 } },
  ],
  // ordem de desenho default (de tras pra frente); o binding de cada
  // personagem pode sobrepor por parte se precisar.
  defaultZIndex: {
    'leg-left': 0,
    'leg-right': 1,
    torso: 2,
    'arm-off': 3,
    head: 4,
    'arm-main': 5,
  },
};

function getArchetype(name) {
  if (name && name !== HUMANOID_MEDIUM.archetype) {
    throw new Error(`Arquetipo desconhecido: ${name}. So existe "humanoid-medium" por enquanto.`);
  }
  return HUMANOID_MEDIUM;
}

function boneNames(archetype = HUMANOID_MEDIUM) {
  return archetype.bones.map((b) => b.name);
}

module.exports = { HUMANOID_MEDIUM, getArchetype, boneNames };
