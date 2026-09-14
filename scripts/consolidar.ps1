# ============================================================================
# Consolidacao em UMA UNICA versao do isometric-character-studio
# Rode isso no PowerShell, dentro de C:\GitHub\isometric-character-studio
# (ou de qualquer lugar -- o script ja da "cd" pra pasta certa).
# ============================================================================

cd C:\GitHub\isometric-character-studio

# 0) Remote confirmado: origin = https://github.com/PilotodeMouse/character-studio.git
#    (nao precisa mexer em nada aqui, so deixei registrado).

# 1) Commita na master os arquivos que eu ja corrigi direto no disco
#    (pivo do Spriter, PIXELS_PER_UNIT=100, escala aplicada no bake).
git add src renderer
git commit -m "fix: pivo do Spriter, PIXELS_PER_UNIT=100 e escala aplicada no bake"

# 2) Traz pra dentro da master tudo que so existe na branch de preview
#    (guias do VTT, fundo transparente/solido, outline+clique direito, zoom).
git merge worktree-preview-ux-improvements -m "merge: preview UX (guias VTT, fundo, outline, zoom) na master"
# Se aparecer "CONFLICT" em algum arquivo aqui, NAO edite nada a mao --
# o passo 3 abaixo sobrescreve exatamente esses arquivos com a versao ja
# corrigida e resolve o conflito sozinho.

# 3) Por cima do merge, aplica a versao mais recente e corrigida (pivo +
#    escala + scml-rig.js) que estava so em _correcoes-worktree.
Copy-Item -Force ".\_correcoes-worktree\src\*.js" ".\src\"
Copy-Item -Force ".\_correcoes-worktree\renderer\app.js" ".\renderer\"
git add src renderer
git commit -m "fix: aplica correcoes de pivo/escala tambem na branch de preview apos o merge"
# Se der "nothing to commit, working tree clean", tudo bem -- so significa
# que o passo 2 nao tinha gerado conflito nesses arquivos.

# 4) Limpeza: remove o worktree, a branch ja mergeada e as pastas de rascunho.
git worktree remove preview-ux-improvements --force
git branch -d worktree-preview-ux-improvements
Remove-Item -Recurse -Force ".\_correcoes-worktree"
Remove-Item -Recurse -Force ".\Claude outputs"

# 5) Sobe a versao unica e final para o GitHub.
git push origin master

Write-Host ""
Write-Host "Pronto. A partir de agora so existe UMA pasta (src/renderer na master)" -ForegroundColor Green
Write-Host "e ela e a mesma coisa que esta no GitHub." -ForegroundColor Green
