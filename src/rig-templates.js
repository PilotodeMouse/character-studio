// Templates de rig embutidos no proprio app: o .scml + .unitypackage de um
// personagem-base da Craftpix, empacotados junto do codigo (pasta
// templates/<id>/), pra quem so quer desenhar uma skin nova nao precisar
// duplicar pasta nenhuma da biblioteca -- so entra com a arte por peca.
//
// Cada template tem a MESMA estrutura de um personagem craftpix-classic
// normal (PNG/Vector Parts/Animations.scml + Unity Package/*.unitypackage),
// entao detectCraftpixClassic() funciona nele sem nenhuma adaptacao.
const fs = require('fs');
const path = require('path');
const { detectCraftpixClassic } = require('./craftpix-profile');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'templates');

const TEMPLATES = [
  { id: 'skeleton-crusader', label: 'Skeleton Crusader' },
];

function listTemplates() {
  return TEMPLATES.filter((t) => fs.existsSync(path.join(TEMPLATES_ROOT, t.id)));
}

function getTemplateDir(templateId) {
  const known = TEMPLATES.find((t) => t.id === templateId);
  if (!known) throw new Error(`Template desconhecido: ${templateId}`);
  return path.join(TEMPLATES_ROOT, templateId);
}

// Detecta o template como se fosse uma pasta craftpix-classic normal, e
// devolve junto a lista de nomes de arquivo canonicos (Body.png, Head.png,
// ...) que o usuario pode substituir por arte propria.
function loadTemplate(templateId) {
  const dir = getTemplateDir(templateId);
  const detected = detectCraftpixClassic(dir);
  if (!detected) throw new Error(`Template "${templateId}" nao tem a estrutura esperada em ${dir}`);
  const partNames = fs
    .readdirSync(detected.vectorPartsDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
  return { id: templateId, dir, detected, partNames };
}

module.exports = { listTemplates, getTemplateDir, loadTemplate };
