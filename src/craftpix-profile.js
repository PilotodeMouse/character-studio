// Perfil "craftpix-classic": a estrutura de pastas que se repete em toda a
// biblioteca Chibi da Craftpix (Esqueletos, Anjos, Golens, Ninja e Assassino,
// etc.) -- <Personagem>/PNG/Vector Parts/Animations.scml + <Personagem>/Unity
// Package/*.unitypackage. Como o rig (nomes de bones e de partes) e
// IDENTICO entre os personagens dessa serie, o mesmo mapeamento de
// animacoes serve para a biblioteca inteira sem configuracao por
// personagem -- e exatamente o "aplicar animacoes default a um personagem
// com as mesmas caracteristicas" pedido no projeto.
const fs = require('fs');
const path = require('path');

// Nomes de clip do Unity (== nomes das pastas PNG Sequences da Craftpix)
// mapeados para os papeis que o VTT exige (idle/walk) e outros uteis para
// exportar como extras opcionais.
const DEFAULT_ANIMATION_MAP = {
  idle: 'Idle',
  walk: 'Walking',
};

const EXTRA_ANIMATIONS = [
  'Running',
  'Slashing',
  'Run Slashing',
  'Slashing in The Air',
  'Throwing',
  'Run Throwing',
  'Throwing in The Air',
  'Kicking',
  'Sliding',
  'Jump Start',
  'Jump Loop',
  'Falling Down',
  'Hurt',
  'Dying',
  'Idle Blinking',
];

// Nome da subpasta opcional com arte de costas DESENHADA (nao so uma pose
// diferente da mesma arte da frente). Fica dentro da propria "Vector Parts"
// pra viajar junto quando alguem copia a pasta do personagem inteira. Aceita
// "Back" ou "Costas" pra nao forcar padrao de idioma.
const BACK_ART_DIRNAMES = ['Back', 'Costas'];

function findBackArtDir(vectorPartsDir) {
  for (const name of BACK_ART_DIRNAMES) {
    const p = path.join(vectorPartsDir, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

function detectCraftpixClassic(characterDir) {
  const vectorPartsDir = path.join(characterDir, 'PNG', 'Vector Parts');
  const unityDir = path.join(characterDir, 'Unity Package');
  if (!fs.existsSync(vectorPartsDir) || !fs.existsSync(unityDir)) return null;

  const scmlFile = fs.readdirSync(vectorPartsDir).find((f) => f.toLowerCase().endsWith('.scml'));
  const unityFile = fs.readdirSync(unityDir).find((f) => f.endsWith('.unitypackage'));
  if (!scmlFile || !unityFile) return null;

  return {
    profile: 'craftpix-classic',
    vectorPartsDir,
    scmlPath: path.join(vectorPartsDir, scmlFile),
    unitypackagePath: path.join(unityDir, unityFile),
    backArtDir: findBackArtDir(vectorPartsDir), // null se o personagem nao tem view de costas propria
    defaultAnimationMap: { ...DEFAULT_ANIMATION_MAP },
    extraAnimations: EXTRA_ANIMATIONS,
  };
}

module.exports = { detectCraftpixClassic, DEFAULT_ANIMATION_MAP, EXTRA_ANIMATIONS, BACK_ART_DIRNAMES };
