# QA colaborativo — calentamiento audiovisual de Clara

**Fecha:** 2026-09-11
**Estado:** cambio local validado; pendiente de revisión y despliegue a testers.

## Cambio bajo prueba

Clara ya no dispara el saludo solamente porque las pistas de audio/video estén suscritas. Después de adjuntarlas espera tres cuadros de video efectivamente presentados. En navegadores sin `requestVideoFrameCallback`, espera reproducción más cuadros de animación. Un límite de dos segundos evita bloquear indefinidamente el saludo y deja una advertencia diagnóstica.

La consola emite una sola línea sin PII:

```text
[MEDIA_READY] reason=<presented_frames|playing_fallback|timeout> elapsed_ms=<n> frames=<n> ready_state=<n> chroma=<true|false>
```

## Responsabilidades

### Codex

- preservar cambios existentes y limitar la iteración a readiness audiovisual;
- ejecutar pruebas, typecheck, lint y build;
- entregar diff y riesgos conocidos;
- analizar únicamente métricas redactadas;
- no desplegar ni modificar ElevenLabs remoto sin aprobación.

### Revisión humana

- aprobar el despliegue a testers;
- evaluar si voz y labios comienzan juntos desde el saludo;
- repetir desde dispositivos donde el problema aparecía;
- marcar cualquier cambio en naturalidad, tiempo de espera, saludo duplicado o micrófono;
- no copiar transcripciones ni datos personales al reporte.

## Matriz mínima para la primera validación

Ejecutar cinco sesiones frías por dispositivo:

1. desktop de referencia;
2. dispositivo donde se percibió el calentamiento, preferentemente móvil o equipo de menor potencia.

En cada sesión:

1. recargar completamente la página;
2. iniciar Clara y observar el saludo;
3. realizar cuatro preguntas breves para cubrir cinco intervenciones contando el saludo;
4. registrar `reason`, `elapsed_ms`, `frames` y `chroma` de `[MEDIA_READY]`;
5. calificar el desfase: `0 = no perceptible`, `1 = leve`, `2 = claro`;
6. registrar en qué intervención, si alguna, la sincronía se vuelve estable.

## Criterio de aprobación provisional

- ningún saludo con desfase claro (`2`);
- ninguna degradación progresiva en los primeros cinco turnos;
- cero saludos duplicados;
- micrófono habilitado después del saludo como antes;
- cero errores nuevos de sesión;
- cero resultados `timeout` en la matriz mínima;
- el tiempo adicional de readiness se mantiene dentro del límite de dos segundos.

Si el problema persiste, separar resultados por `chroma=true/false`, dispositivo y motivo de readiness antes de tocar TTS, LLM o configuración de ElevenLabs.

## Verificaciones automatizadas completadas

- test focalizado: 3/3;
- suite completa: 66/66;
- TypeScript: PASS;
- ESLint: PASS;
- build Next.js de producción: PASS.

Warnings preexistentes/no bloqueantes del build: datos de compatibilidad de navegadores desactualizados y migración futura de `middleware` a `proxy`.
