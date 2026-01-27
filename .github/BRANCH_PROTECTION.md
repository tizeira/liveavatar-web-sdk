# Branch Protection Rules - GitHub Configuration

## 🔒 Protección de Branches Críticas

Para evitar que **NADIE** (ni Claude Code con tu token) pueda mergear PRs sin aprobación manual, configura estas reglas en GitHub.

## Configuración Requerida

### 1. GitHub Settings → Branches → Add rule

#### Para `master` (Production)

```yaml
Branch name pattern: master

☑ Require a pull request before merging
  ☑ Require approvals: 1
  ☑ Dismiss stale pull request approvals when new commits are pushed
  ☑ Require review from Code Owners (opcional)

☑ Require status checks to pass before merging
  ☑ Require branches to be up to date before merging
  Status checks: (seleccionar los que apliquen)
    ☑ Vercel - liveavatar-web-sdk (Build)
    ☑ continuous-integration/github-actions
    ☑ build
    ☑ lint
    ☑ typecheck

☑ Require conversation resolution before merging

☑ Require linear history (opcional - para git history limpio)

☑ Do not allow bypassing the above settings
  ⚠️ CRÍTICO: Esto impide que NADIE (ni admins, ni bots, ni Claude)
             pueda mergear sin seguir las reglas

☑ Restrict who can push to matching branches (opcional)
  - Solo agregar usuarios específicos que pueden hacer push directo
  - O dejarlo vacío para bloquear TODOS los push directos
```

#### Para `develop` (Preview)

```yaml
Branch name pattern: develop

☑ Require a pull request before merging
  ☑ Require approvals: 1 (o 0 si querés más flexibilidad)

☑ Require status checks to pass before merging
  Status checks:
    ☑ build
    ☑ lint
    ☑ typecheck

☑ Do not allow bypassing the above settings
```

## Verificación

Una vez configurado, intenta:

```bash
# Esto debería FALLAR
gh pr merge 123 --merge

# Error esperado:
# Pull request merge failed:
# Reviews required (1 review required by reviewers)
```

## Workflow Post-Configuración

### Claude Code (Automatizado)

1. ✅ Desarrollo código
2. ✅ Commit + Push
3. ✅ `gh pr create`
4. ❌ `gh pr merge` → **BLOQUEADO POR GITHUB**

### Usuario (Manual)

1. 👤 Revisa PR en https://github.com/tizeira/liveavatar-web-sdk/pulls
2. 👤 Testea en preview si es necesario
3. 👤 Aprueba PR (botón "Approve")
4. 👤 Mergea PR (botón "Merge pull request")

## Beneficios

- ✅ **Seguridad:** Ningún bot/script puede mergear sin aprobación
- ✅ **Control:** Solo vos decidís qué va a producción
- ✅ **Trazabilidad:** Todas las PRs tienen aprobación explícita
- ✅ **Calidad:** Status checks obligatorios (build, lint, tests)
- ✅ **Prevención:** Evita merges accidentales o automáticos

## Estado Actual

**⚠️ WARNING:** Actualmente las branch protection rules NO están configuradas.
Claude Code pudo mergear PRs automáticamente.

**Acción requerida:** Configurar las reglas arriba para bloquear esto en el futuro.

## Comando para Verificar (CLI)

```bash
# Ver reglas actuales de master
gh api repos/tizeira/liveavatar-web-sdk/branches/master/protection

# Ver reglas actuales de develop
gh api repos/tizeira/liveavatar-web-sdk/branches/develop/protection
```
