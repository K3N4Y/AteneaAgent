# Contexto y propósito

## Qué es MyAgent

MyAgent es una **aplicación de escritorio** que actúa como un agente de
codificación con IA, con una interfaz de **chat tipo Codex**. El usuario
conversa con la app y esta lee, escribe y modifica archivos, ejecuta comandos
y, en su forma más ambiciosa, construye un programa **end-to-end** (de cero a
una app funcional con su propia UI).

Se empaqueta con **Tauri** para ser una app nativa de escritorio (ventana,
icono, instalable), pero — por decisión de la primera etapa — **toda la lógica
está escrita en TypeScript**. Rust se usa únicamente como la cáscara mínima de
la ventana. Ver [arquitectura-backend.md](./arquitectura-backend.md) para el
detalle de cómo se logra "todo en TS" dentro de Tauri.

## El problema que resuelve

Las herramientas de agente de código suelen vivir en la terminal o en una
extensión del editor. MyAgent apuesta por una **app de escritorio dedicada**:
una ventana propia, persistente, con una UI pensada para conversar con varios
agentes especializados y ver en vivo qué archivos toca, qué comandos corre y
qué planea hacer antes de hacerlo.

## Los 3 agentes del chat

El chat ofrece tres "modos" o agentes, seleccionables por el usuario. Comparten
el mismo motor pero difieren en su *system prompt*, sus permisos de
herramientas y su forma de trabajar:

| Agente   | Rol | Permisos | Resultado típico |
|----------|-----|----------|------------------|
| **Plan**  | Analiza el pedido y el código, propone un plan paso a paso. **No modifica nada.** | Solo lectura (leer archivos, buscar, listar) | Un plan en markdown que el usuario aprueba |
| **Build** | El agente clásico: implementa cambios de forma iterativa sobre un proyecto existente. | Lectura + escritura + ejecución de comandos | Archivos editados, tests corridos |
| **E2E**   | Construye un programa completo desde cero: estructura, dependencias, código, UI, pruebas y ejecución. | Todo lo de Build + scaffolding + correr la app | Un proyecto funcional nuevo |

> Internamente Plan → Build → E2E son una **escalada de capacidad**: cada uno
> habilita más herramientas y más autonomía que el anterior. E2E puede
> orquestar a los otros dos (planificar y luego construir).

## Alcance de la primera etapa ("lo básico")

El objetivo inmediato **no** es tener los 3 agentes perfectos, sino tener la
base funcionando:

1. La cáscara de Tauri abre una ventana.
2. El sidecar de TypeScript (motor del agente) arranca y se comunica con la UI.
3. Una UI de chat mínima que envía mensajes y muestra respuestas en streaming.
4. Un agente funcionando de punta a punta con al menos una herramienta real
   (leer/escribir archivos).

Una vez que ese flujo completo funcione, se separan los 3 perfiles de agente y
se enriquece la UI. Ver [pendiente.md](./pendiente.md) para el plan por fases y
[vision.md](./vision.md) para hacia dónde va el proyecto.

## Stack (resumen)

- **Cáscara de escritorio:** Tauri v2 (Rust mínimo, sin lógica de negocio).
- **Frontend / UI:** TypeScript + React + Vite (webview de Tauri).
- **Motor del agente ("backend"):** TypeScript sobre Node.js, corriendo como
  *sidecar* de Tauri.
- **IA:** detrás de una **capa de proveedores intercambiable**. Proveedor
  activo de arranque: **OpenCode Zen** (API compatible con OpenAI), vía el SDK
  de OpenAI apuntando a su `baseURL`. Claude (`@anthropic-ai/sdk`) y OpenAI
  "real" se agregan después; cada uno = un adaptador.
- **Lenguaje único:** TypeScript de extremo a extremo (UI y motor).

## Glosario rápido

- **Sidecar:** proceso externo que Tauri lanza y administra junto a la app.
  Aquí es el proceso Node que contiene el motor del agente.
- **Motor del agente / agent loop:** el bucle que llama al modelo, ejecuta las
  herramientas que pide y le devuelve los resultados hasta terminar la tarea.
- **Herramienta (tool):** una función que el agente puede invocar (leer
  archivo, escribir archivo, correr comando, etc.).
- **Sesión:** una conversación del chat con su historial y su estado.
