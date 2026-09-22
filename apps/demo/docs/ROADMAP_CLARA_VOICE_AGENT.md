# ROADMAP - Clara Voice Agent

> **Estado actual:** MVP funcional desplegado en producción
> **URL:** https://liveavatar-web-sdk-demo-sigma.vercel.app
> **Fecha:** 19 Diciembre 2024

---

## RESUMEN EJECUTIVO

Clara es un agente de voz con avatar 3D que combina:

- **ElevenLabs** - STT + LLM + TTS (Conversational AI)
- **HeyGen** - Avatar con lip sync en tiempo real
- **NextAuth** - Autenticación con Google OAuth

### Stack Tecnologico Actual

| Componente | Tecnologia                       |
| ---------- | -------------------------------- |
| Frontend   | Next.js 16, React 19, TypeScript |
| UI         | Tailwind CSS, shadcn/ui          |
| Auth       | NextAuth v5 + Google OAuth       |
| Voice AI   | ElevenLabs Conversational AI     |
| Avatar     | HeyGen LiveAvatar SDK            |
| Deploy     | Vercel                           |

---

## FASE 1: ESTABILIZACION (Semana actual)

### 1.1 Audio Optimization

| Tarea                                     | Estado        | Prioridad |
| ----------------------------------------- | ------------- | --------- |
| Estrategia dos fases (immediate + gap)    | ✅ Completado | -         |
| Ajustar IMMEDIATE_SEND_DELAY si necesario | ⏳ Monitorear | MEDIA     |
| Probar en diferentes velocidades de red   | ⏳ Pendiente  | MEDIA     |

### 1.2 Testing en Produccion

| Tarea                               | Estado       | Prioridad |
| ----------------------------------- | ------------ | --------- |
| Verificar login Google              | ⏳ Pendiente | ALTA      |
| Verificar audio completo sin cortes | ⏳ Pendiente | ALTA      |
| Verificar lip sync timing           | ⏳ Pendiente | ALTA      |
| Probar en Chrome, Firefox, Edge     | ⏳ Pendiente | MEDIA     |
| Verificar fallback Safari iOS       | ⏳ Pendiente | BAJA      |

### 1.3 Bugs Conocidos

| Bug                    | Descripcion                   | Prioridad |
| ---------------------- | ----------------------------- | --------- |
| API request failed     | Error intermitente de HeyGen  | MEDIA     |
| Middleware deprecation | Next.js 16 depreco middleware | BAJA      |

---

## FASE 2: MEJORAS UX/UI (1-2 semanas)

### 2.1 Interfaz de Usuario

| Mejora           | Descripcion                      | Prioridad |
| ---------------- | -------------------------------- | --------- |
| Loading states   | Spinners/skeletons durante carga | ALTA      |
| Error boundaries | Manejo graceful de errores       | ALTA      |
| Reconnection UI  | Mostrar estado de reconexion     | MEDIA     |
| Volume controls  | Control de volumen del avatar    | MEDIA     |
| Mute button      | Silenciar microfono del usuario  | MEDIA     |
| Fullscreen mode  | Avatar en pantalla completa      | BAJA      |

### 2.2 Feedback Visual

| Mejora                 | Descripcion                  | Prioridad |
| ---------------------- | ---------------------------- | --------- |
| Indicador "escuchando" | Animacion cuando detecta voz | ALTA      |
| Indicador "pensando"   | Mientras LLM procesa         | ALTA      |
| Indicador "hablando"   | Mientras avatar responde     | ALTA      |
| Transcripcion en vivo  | Mostrar lo que usuario dice  | MEDIA     |
| Subtitulos             | Mostrar respuesta del agente | MEDIA     |

### 2.3 Responsive Design

| Mejora              | Descripcion            | Prioridad |
| ------------------- | ---------------------- | --------- |
| Mobile-first layout | Optimizar para moviles | ALTA      |
| Tablet layout       | Diseño intermedio      | MEDIA     |
| Desktop layout      | Aprovechar espacio     | MEDIA     |

---

## FASE 3: FEATURES CORE (2-4 semanas)

### 3.1 Chat History (FEAT-005)

| Tarea                  | Descripcion                 | Prioridad |
| ---------------------- | --------------------------- | --------- |
| Persistir conversacion | Guardar en localStorage/DB  | ALTA      |
| UI de historial        | Panel lateral con mensajes  | ALTA      |
| Exportar conversacion  | Descargar como texto/PDF    | BAJA      |
| Buscar en historial    | Filtrar mensajes anteriores | BAJA      |

### 3.2 Personalizacion del Agente

| Tarea                     | Descripcion                 | Prioridad |
| ------------------------- | --------------------------- | --------- |
| Selector de avatar        | Diferentes avatares HeyGen  | MEDIA     |
| Selector de voz           | Diferentes voces ElevenLabs | MEDIA     |
| Personalidad configurable | Ajustar prompt del agente   | ALTA      |
| Idioma                    | Soporte multiidioma         | MEDIA     |

### 3.3 Analytics

| Tarea                      | Descripcion              | Prioridad |
| -------------------------- | ------------------------ | --------- |
| Tracking de conversaciones | Numero, duracion, temas  | ALTA      |
| Metricas de latencia       | Tiempo de respuesta      | MEDIA     |
| Satisfaccion del usuario   | Rating post-conversacion | MEDIA     |
| Dashboard de admin         | Visualizar metricas      | BAJA      |

---

## FASE 4: INTEGRACION SHOPIFY (4-6 semanas)

### 4.1 Arquitectura de Integracion

```
┌─────────────────────────────────────────────────────────────┐
│                    SHOPIFY STORE                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Theme     │    │  Shopify    │    │   Shopify   │     │
│  │  Extension  │───▶│    App      │◀───│   Admin     │     │
│  │  (Widget)   │    │  (Backend)  │    │     API     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                                 │
│         ▼                  ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              CLARA VOICE AGENT                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │   │
│  │  │ElevenLabs│  │  HeyGen  │  │ Product  │          │   │
│  │  │   API    │  │   API    │  │ Context  │          │   │
│  │  └──────────┘  └──────────┘  └──────────┘          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Shopify App Development

| Tarea             | Descripcion                   | Prioridad |
| ----------------- | ----------------------------- | --------- |
| Crear Shopify App | Registro en Partner Dashboard | ALTA      |
| OAuth flow        | Autenticacion con tiendas     | ALTA      |
| App Bridge setup  | Integracion con admin         | ALTA      |
| Billing API       | Planes de suscripcion         | MEDIA     |

### 4.3 Theme Extension (Widget)

| Tarea             | Descripcion               | Prioridad |
| ----------------- | ------------------------- | --------- |
| App Block         | Widget embebible en theme | ALTA      |
| Floating button   | Boton para abrir Clara    | ALTA      |
| Modal/Drawer      | Contenedor del avatar     | ALTA      |
| Customization     | Colores, posicion, tamaño | MEDIA     |
| Mobile responsive | Adaptar a moviles         | ALTA      |

### 4.4 Integracion con Catalogo

| Tarea              | Descripcion                  | Prioridad |
| ------------------ | ---------------------------- | --------- |
| Sync productos     | Importar catalogo a contexto | ALTA      |
| Busqueda semantica | RAG sobre productos          | ALTA      |
| Recomendaciones    | Sugerir productos relevantes | ALTA      |
| Inventario         | Verificar disponibilidad     | MEDIA     |
| Precios            | Mostrar precios actualizados | MEDIA     |

### 4.5 Integracion con Carrito

| Tarea             | Descripcion       | Prioridad |
| ----------------- | ----------------- | --------- |
| Añadir al carrito | Via voz           | ALTA      |
| Ver carrito       | Resumen por voz   | MEDIA     |
| Checkout redirect | Enviar a checkout | MEDIA     |
| Abandoned cart    | Recordatorios     | BAJA      |

### 4.6 Integracion con Pedidos

| Tarea            | Descripcion          | Prioridad |
| ---------------- | -------------------- | --------- |
| Estado de pedido | Consultar por numero | MEDIA     |
| Tracking         | Informacion de envio | MEDIA     |
| Devoluciones     | Iniciar proceso      | BAJA      |

---

## FASE 5: ESCALABILIDAD (6-8 semanas)

### 5.1 Infraestructura

| Tarea         | Descripcion          | Prioridad |
| ------------- | -------------------- | --------- |
| Rate limiting | Proteger APIs        | ALTA      |
| Caching       | Redis para sesiones  | MEDIA     |
| CDN           | Assets estaticos     | MEDIA     |
| Monitoring    | Sentry, LogRocket    | ALTA      |
| Auto-scaling  | Vercel o alternativa | MEDIA     |

### 5.2 Multi-tenancy

| Tarea            | Descripcion              | Prioridad |
| ---------------- | ------------------------ | --------- |
| Tenant isolation | Separar datos por tienda | ALTA      |
| Custom domains   | Subdominio por cliente   | MEDIA     |
| White-labeling   | Personalizar branding    | MEDIA     |

### 5.3 Base de Datos

| Tarea            | Descripcion                   | Prioridad |
| ---------------- | ----------------------------- | --------- |
| PostgreSQL setup | Supabase o PlanetScale        | ALTA      |
| Schema design    | Usuarios, conversaciones, etc | ALTA      |
| Migrations       | Sistema de migraciones        | MEDIA     |
| Backups          | Automaticos diarios           | ALTA      |

---

## FASE 6: MONETIZACION

### 6.1 Planes de Pricing

| Plan       | Conversaciones/mes | Precio  | Features                      |
| ---------- | ------------------ | ------- | ----------------------------- |
| Free       | 50                 | $0      | Basic avatar, standard voice  |
| Starter    | 500                | $29/mes | Custom avatar, premium voices |
| Pro        | 2,000              | $99/mes | Analytics, priority support   |
| Enterprise | Unlimited          | Custom  | White-label, SLA, dedicated   |

### 6.2 Implementacion

| Tarea              | Descripcion           | Prioridad |
| ------------------ | --------------------- | --------- |
| Stripe integration | Pagos recurrentes     | ALTA      |
| Usage tracking     | Contar conversaciones | ALTA      |
| Plan limits        | Enforcer limites      | ALTA      |
| Upgrade flow       | UI para cambiar plan  | MEDIA     |
| Invoicing          | Facturas automaticas  | MEDIA     |

---

## FASE 7: MEJORAS AVANZADAS (Futuro)

### 7.1 AI/ML

| Mejora                     | Descripcion                           |
| -------------------------- | ------------------------------------- |
| Fine-tuning                | Entrenar modelo en dominio especifico |
| Sentiment analysis         | Detectar estado emocional             |
| Intent classification      | Mejor routing de preguntas            |
| Conversation summarization | Resumir conversaciones largas         |

### 7.2 Integraciones Adicionales

| Integracion                | Descripcion                |
| -------------------------- | -------------------------- |
| WooCommerce                | Plugin para WordPress      |
| BigCommerce                | App para BigCommerce       |
| Magento                    | Extension para Magento     |
| CRM (HubSpot, Salesforce)  | Sync de contactos          |
| Email (Klaviyo, Mailchimp) | Triggers post-conversacion |

### 7.3 Features Premium

| Feature              | Descripcion                          |
| -------------------- | ------------------------------------ |
| Video calls          | Escalar a video con humano           |
| Screen sharing       | Mostrar productos visualmente        |
| Co-browsing          | Guiar al usuario por la tienda       |
| Proactive engagement | Iniciar conversacion automaticamente |

---

## TIMELINE ESTIMADO

```
Dic 2024    ████████░░░░░░░░░░░░  FASE 1: Estabilizacion
Ene 2025    ░░░░░░░░████████░░░░  FASE 2: UX/UI
Feb 2025    ░░░░░░░░░░░░████████  FASE 3: Features Core
Mar-Abr     ░░░░░░░░░░░░░░░░████  FASE 4: Shopify
May-Jun     ░░░░░░░░░░░░░░░░░░██  FASE 5: Escalabilidad
Jul+        ░░░░░░░░░░░░░░░░░░░░  FASE 6-7: Monetizacion + Avanzado
```

---

## RECURSOS NECESARIOS

### Equipo

| Rol            | Responsabilidad      | Dedicacion |
| -------------- | -------------------- | ---------- |
| Full-stack Dev | Desarrollo principal | 100%       |
| UI/UX Designer | Diseño de interfaces | 50%        |
| DevOps         | Infraestructura      | 25%        |
| QA             | Testing              | 25%        |

### Costos Mensuales Estimados (Produccion)

| Servicio   | Costo Estimado           |
| ---------- | ------------------------ |
| ElevenLabs | $99-$330/mes (segun uso) |
| HeyGen     | $59-$199/mes (segun uso) |
| Vercel Pro | $20/mes                  |
| Supabase   | $25/mes                  |
| Monitoring | $30/mes                  |
| **Total**  | **$233-$604/mes**        |

---

## DECISION LOG

| Fecha      | Decision                 | Razon                         |
| ---------- | ------------------------ | ----------------------------- |
| 2024-12-19 | Two-phase audio strategy | Reducir latencia percibida    |
| 2024-12-19 | NextAuth + Google OAuth  | Simplicidad de implementacion |
| 2024-12-19 | Vercel para deploy       | Integracion con Next.js       |

---

## NOTAS IMPORTANTES

1. **ElevenLabs Limits:** Plan actual tiene limite de minutos/mes
2. **HeyGen Concurrent Sessions:** Verificar limites de sesiones simultaneas
3. **Safari iOS:** No soportado por limitaciones de WebRTC
4. **GDPR/Privacy:** Implementar consentimiento antes de grabar voz

---

## LINKS UTILES

- [ElevenLabs Docs](https://elevenlabs.io/docs)
- [HeyGen API Docs](https://docs.heygen.com)
- [Shopify App Development](https://shopify.dev/docs/apps)
- [NextAuth Documentation](https://authjs.dev)
- [Vercel Documentation](https://vercel.com/docs)

---

_Documento vivo - Actualizar conforme avance el proyecto_
