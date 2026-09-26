# Clara LAB: viewport móvil y vidrio translúcido

Reporte del usuario: capturas de iPhone con espacio blanco debajo de la llamada
y controles demasiado opacos. Evidencia de código: body y wrapper usaban
min-h-screen (100vh), mientras las pantallas usaban 100dvh. Esa discrepancia
puede producir altura sobrante con las barras dinámicas del navegador.
La barra nativa del navegador no es contenido de Clara y no se puede eliminar.

Cambios en la rama codex/clara-lab-design-2026-09-25, SHA 78f55ca:
- app/layout.tsx: altura dinámica y fondo base consistente.
- app/page.tsx: wrapper dinámico y ubicación segura del menú de cuenta.
- ClaraVoiceAgent.module.css: vidrio con opacidad 12–24%, blur Safari,
  fallback sin blur, controles táctiles, zonas seguras y orientación horizontal.
- clara-lab-design.test.tsx: regresión de la altura exterior.

Validación: 9 tests de presentación, lint, typecheck y diff-check aprobados;
revisión independiente read-only sin bloqueos. No hay cambios en sesiones,
proveedores, endpoints, base, secretos, Shopify o agentes.

No había navegador conectado disponible para mediciones visuales. No se afirma
prueba física en Safari/iPhone, ni ausencia medida de overflow. La guía
web-design-motion orientó el ajuste de altura útil, safe-area y fallback visual.

Candidato Preview: dpl_HHe7M7oA2uUtCBw58PNMpHRpcmPc.
Rollback testers: dpl_BgQm4tyxrSv5YqP2H2oHvs3Wv6sE
(liveavatar-web-sdk-demo-4eqpurlu7.vercel.app).
Producción debe permanecer en dpl_9YX7sMRM9huyjpGPUmCGTiX24Dqf.

Resultado: Preview READY, preflight read-only aprobado, sólo testers reasignado
al candidato. Smoke antes/después: raíz 307, catálogo y rutina sin credenciales
401. Lectura final confirma testers actualizado y producción sin cambios.
La validación HTTP no sustituye la prueba visual física pendiente.

Validación pendiente del usuario: recargar QA en el mismo iPhone; comprobar
conexión, llamada, resumen y rutina; rotar el dispositivo y mostrar/ocultar las
barras del navegador. Confirmar controles visibles, legibles y sin espacio
extra desplazable. No iniciar pruebas productivas para este ajuste visual.
