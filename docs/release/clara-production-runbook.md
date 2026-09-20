# Clara — runbook de promoción a Producción

Este documento es una puerta de liberación, no una autorización para desplegar. Mantener Clara en LiveAvatar LITE con el conector de ElevenLabs; no cambiar de proveedor ni de modo dentro de este recorrido.

## Snapshot de Neon

- [ ] Registrar un snapshot recuperable de la rama productiva de Neon, con fecha, responsable y ubicación de restauración.
- [ ] Confirmar que el snapshot puede restaurarse sin afectar la rama QA.

## Migración Prisma

- [ ] Revisar el SQL de `apps/demo/prisma/migrations/20260914170000_init_clara_core/migration.sql` contra el esquema productivo.
- [ ] Ejecutar la migración únicamente sobre la rama productiva aprobada, después del snapshot.
- [ ] Verificar que existen `clara_consultations` y `clara_daily_metrics`; no cargar datos de prueba.

## Orden de despliegue

1. Preparar y aprobar un commit candidato limpio desde el QA validado; identificar su SHA y el flujo Git acordado. No asumir integración en `develop` ni promover el checkout principal sucio. Incorporar el preflight y este runbook al candidato antes de aprobarlo.
2. Crear un artefacto JSON de evidencia para este release y ejecutar `pnpm --filter demo run preflight:production -- --evidence=<ruta-al-json>`. Debe pasar sin mostrar valores de secretos.
3. Desplegar la aplicación en Producción mediante el flujo aprobado de Vercel, sin cambiar agentes, tráfico ni secretos durante el despliegue.
4. Hacer smoke test protegido: acceso sin cookie debe rechazar; enlace Shopify v2 recién firmado debe canjearse por cookie y limpiar la URL; una sesión debe poder comenzar y terminar.
5. Confirmar post-call, herramientas autorizadas, retención y liberación de rate limit con una cuenta de prueba. Proveedor y voz ya fueron validados por el usuario en QA; esto no valida automáticamente su configuración productiva.
6. Solo después del smoke test de aplicación, actualizar el theme live con los archivos explícitamente aprobados: `templates/page.clara.liquid` y los CTAs de `templates/page.clara-landing.json`. Guardar primero una copia verificable del Liquid live. No cambiar la contraseña global de Shopify.

## Rollback

- [ ] Conservar el deployment productivo anterior de Vercel y su identificador antes de promover.
- [ ] Si falla la aplicación, volver al deployment anterior antes de tocar Shopify.
- [ ] Si falla el theme, restaurar únicamente los archivos Shopify respaldados; no publicar otro theme.
- [ ] Si falla la migración, detener la promoción y evaluar el estado antes de cualquier restauración. Restaurar un snapshot puede perder escrituras posteriores: requiere autorización específica y plan de recuperación de esas escrituras. No hacer una restauración automática ni una reversión manual de SQL sin revisión.
- [ ] Mantener el agente de ElevenLabs Main y su porcentaje de tráfico sin cambios durante todo el rollback.

## Evidencia requerida para aprobar

- [ ] PR integrada con checks verdes y deployment candidato identificado.
- [ ] Preflight de Production verde.
- [ ] Smoke test de acceso Shopify v2, cookie y rate limiting documentado.
- [ ] Prueba de voz/post-call completada tras reactivar el proveedor.
- [ ] Confirmación manual móvil y escritorio, micrófono, primer saludo y cierre de sesión.

El preflight no toma estas casillas del runbook como aprobación permanente. Requiere un JSON nuevo para cada release, almacenado con los demás artefactos de la promoción y no necesariamente versionado. Debe contener el SHA exacto que se promueve, la fecha de verificación y todas las puertas aprobadas:

```json
{
  "commitSha": "SHA_COMPLETO_DEL_COMMIT",
  "verifiedAt": "2026-09-18T00:00:00Z",
  "gates": {
    "neonSnapshot": true,
    "prismaMigration": true,
    "previousVercelDeployment": true,
    "pullRequestChecks": true,
    "shopifyAccessQa": true,
    "voicePostCallQa": true,
    "mobileDesktopQa": true
  }
}
```

No incluir secretos, URLs firmadas, cookies ni datos de clientes en ese archivo. Si cambia el commit, generar y aprobar evidencia nueva; el preflight rechazará automáticamente evidencia de otro SHA.
