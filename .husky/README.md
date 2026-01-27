# Git Hooks - Husky

Este directorio contiene los hooks de Git configurados con Husky para proteger el repositorio.

## Hooks Activos

### 1. `pre-commit`

**Ejecuta antes de cada commit**

Acciones:

- ✅ Bloquea commits directos a `master`
- ✅ Formatea código con Prettier
- ✅ Ejecuta linters (ESLint)
- ✅ Ejecuta typecheck (TypeScript)
- ✅ Ejecuta tests

### 2. `pre-push`

**Ejecuta antes de cada push**

Acciones:

- ✅ Bloquea push a upstream (heygen-com)
- ✅ Bloquea push directo a `master` y `develop`
- ✅ Valida workflow de PRs
- ⚠️ Advierte sobre intento de merge automático

### 3. `validate-pr-workflow`

**Script de validación personalizado**

Acciones:

- ✅ Detecta push directo a branches protegidas
- ⚠️ Muestra warnings sobre merge de PRs
- ℹ️ Documenta workflow correcto

## 🚨 Limitaciones

**Lo que los hooks PUEDEN bloquear:**

- ✅ Commits directos a `master`
- ✅ Push directo a `master` o `develop`
- ✅ Push a upstream incorrecto

**Lo que los hooks NO PUEDEN bloquear:**

- ❌ `gh pr merge` (comando externo de GitHub CLI)
- ❌ Merge de PRs desde GitHub UI
- ❌ Acciones realizadas directamente en github.com

## 🔒 Protección Completa

Para bloquear completamente los merges automáticos, se requiere:

1. **Git Hooks** (este directorio) - Bloquea operaciones locales
2. **GitHub Branch Protection Rules** - Bloquea operaciones remotas

Ver documentación completa: `.github/BRANCH_PROTECTION.md`

## Testing Hooks

```bash
# Test pre-commit (intenta commit a master)
git checkout master
git commit -m "test" --allow-empty
# Debería fallar ❌

# Test pre-push (intenta push a master)
git checkout master
git push origin master
# Debería fallar ❌

# Workflow correcto
git checkout develop
git checkout -b feature/test
git commit -m "test" --allow-empty
git push -u origin feature/test
# Debería pasar ✅
```

## Bypass de Hooks (Solo Emergencias)

**⚠️ NO RECOMENDADO - Solo para emergencias críticas**

```bash
# Bypass pre-commit
git commit --no-verify

# Bypass pre-push
git push --no-verify
```

**Consecuencias:**

- ❌ No se ejecutan linters
- ❌ No se ejecutan tests
- ❌ No se valida formato
- ❌ Se pierde protección

**Usar solo si:**

- Hotfix crítico de producción caído
- Con autorización explícita del tech lead
- Crear issue inmediatamente después para fix proper
