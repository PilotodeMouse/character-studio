// Um "binding" e o rigging de UM personagem: qual arquivo SVG cobre cada
// osso do rig semantico, com que pivo/offset/escala. E o unico dado que
// muda de personagem para personagem -- fica salvo como binding.json
// dentro da PROPRIA pasta de arte do personagem (viaja junto com o SVG,
// nao fica num cache central).
const fs = require('fs');
const path = require('path');
const { boneNames } = require('./semantic-rig');

const BINDING_FILENAME = 'binding.json';

function bindingPathFor(characterDir) {
  return path.join(characterDir, BINDING_FILENAME);
}

function loadBinding(characterDir) {
  const p = bindingPathFor(characterDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveBinding(characterDir, binding) {
  fs.writeFileSync(bindingPathFor(characterDir), JSON.stringify(binding, null, 2));
}

function emptyBinding(characterName, archetype = 'humanoid-medium') {
  const parts = {};
  for (const name of boneNames()) {
    parts[name] = null; // ainda nao atribuido a nenhum arquivo
  }
  return { archetype, characterName, parts };
}

function setPart(binding, boneName, partData) {
  if (!(boneName in binding.parts)) {
    throw new Error(`Osso "${boneName}" nao existe no arquetipo ${binding.archetype}`);
  }
  binding.parts[boneName] = {
    file: partData.file,
    pivotX: partData.pivotX ?? 0.5,
    pivotY: partData.pivotY ?? 0.5,
    offsetX: partData.offsetX ?? 0,
    offsetY: partData.offsetY ?? 0,
    scale: partData.scale ?? 1,
    rotationOffset: partData.rotationOffset ?? 0,
    zIndex: partData.zIndex,
  };
}

function isComplete(binding) {
  return Object.values(binding.parts).every((p) => p !== null);
}

module.exports = { loadBinding, saveBinding, emptyBinding, setPart, isComplete, bindingPathFor, BINDING_FILENAME };
