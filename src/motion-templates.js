// Biblioteca de animacoes-template: definidas UMA vez contra o rig semantico
// (semantic-rig.js), reutilizadas por qualquer personagem que tenha um
// binding valido (character-binding.js). Cada template e uma funcao pura
// (osso, tempo em ms) -> delta {dx,dy,dangle} somado a pose de bind do osso.
// Nao ha curva "por personagem": trocar a arte nunca muda o movimento.
const TAU = Math.PI * 2;

function zero() {
  return { dx: 0, dy: 0, dangle: 0 };
}

const IDLE = {
  name: 'idle',
  length: 1600, // ms -- 4 frames a 160ms/frame (padrao idle do VTT) fecham 1 loop
  loop: true,
  sample(boneName, t) {
    const phase = (t / this.length) * TAU;
    switch (boneName) {
      case 'torso':
        return { dx: 0, dy: Math.sin(phase) * 3, dangle: Math.sin(phase) * 1.5 };
      case 'head':
        return { dx: 0, dy: Math.sin(phase + 0.3) * 2, dangle: Math.sin(phase + 0.3) * 1 };
      case 'arm-main':
        return { dx: 0, dy: 0, dangle: Math.sin(phase + Math.PI) * 3 };
      case 'arm-off':
        return { dx: 0, dy: 0, dangle: Math.sin(phase + Math.PI) * 3 };
      default:
        return zero();
    }
  },
};

const WALK = {
  name: 'walk',
  length: 800, // ms -- ciclo de passada completo
  loop: true,
  sample(boneName, t) {
    const phase = (t / this.length) * TAU;
    switch (boneName) {
      case 'leg-left':
        return { dx: 0, dy: 0, dangle: Math.sin(phase) * 25 };
      case 'leg-right':
        return { dx: 0, dy: 0, dangle: Math.sin(phase + Math.PI) * 25 };
      case 'arm-main':
        return { dx: 0, dy: 0, dangle: Math.sin(phase + Math.PI) * 20 };
      case 'arm-off':
        return { dx: 0, dy: 0, dangle: Math.sin(phase) * 20 };
      case 'torso':
        return { dx: 0, dy: Math.abs(Math.sin(phase * 2)) * 4, dangle: Math.sin(phase) * 2 };
      case 'head':
        return { dx: 0, dy: Math.abs(Math.sin(phase * 2)) * 2.4, dangle: 0 };
      default:
        return zero();
    }
  },
};

const TEMPLATES = { idle: IDLE, walk: WALK };

function getTemplate(name) {
  const t = TEMPLATES[name];
  if (!t) throw new Error(`Template de animacao desconhecido: ${name}`);
  return t;
}

module.exports = { TEMPLATES, getTemplate };
