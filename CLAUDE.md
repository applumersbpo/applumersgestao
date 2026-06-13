# Regras do Projeto — applumersgestao

## Regras de Deploy para Produção

### Problema conhecido
O projeto tem **integração GitHub ativa na Vercel**. Ao fazer `git push`, a Vercel dispara um deploy automático via integração. Se rodar `vercel --prod` ao mesmo tempo, dois deploys concorrem pelo alias de produção — race condition que pode servir código errado ou desatualizado.

### Processo obrigatório antes de qualquer deploy

1. **Verificar que TODOS os arquivos modificados estão commitados**
   ```bash
   git status
   git diff HEAD
   ```
   Nenhum arquivo com mudanças relevantes deve ficar fora do commit.

2. **Commitar apenas arquivos relacionados à mudança**
   ```bash
   git add <arquivo1> <arquivo2>   # NUNCA git add -A ou git add .
   git commit -m "tipo: descrição"
   ```

3. **Fazer o push separado do deploy — nunca juntos**
   ```bash
   git push
   # Aguardar o deploy da integração GitHub terminar (~30-60s)
   # Verificar em: https://vercel.com/lumers-bpo-s-projects/applumersgestao
   ```

4. **Rodar `vercel --prod --force` após a integração GitHub terminar**
   - `--force` ignora o cache de build e garante que os arquivos mais recentes são usados
   - Isso sobrescreve o alias de produção de forma definitiva com o deploy correto
   ```bash
   vercel --prod --force
   ```

5. **Confirmar qual deployment está servindo o alias de produção**
   ```bash
   vercel inspect <url-do-deploy> 2>&1 | grep -A5 "Aliases"
   ```
   O alias `https://app.lumersbpo.com.br` deve apontar para o deploy recém-criado.

6. **Verificar a URL de produção no browser** (hard refresh: Ctrl+Shift+R)

### Regra resumida
```
git add <arquivos> → git commit → git push → aguardar integração → vercel --prod --force → verificar alias
```

### Nunca fazer
- ❌ `git push && vercel --prod` (race condition)
- ❌ Commitar `.env.production`, `.claude/`, `exemplo.jpg` ou arquivos de credencial
- ❌ `git add -A` ou `git add .` sem revisar o que está sendo incluído
- ❌ Deploy sem antes verificar `git status` e `git diff HEAD`
