# Pendiente (backlog y plan por fases)

> Lista accionable. El "porqué" y el mapa de alto nivel están en
> [vision.md](./vision.md); las decisiones técnicas, en
> [arquitectura-backend.md](./arquitectura-backend.md) y
> [arquitectura-frontend.md](./arquitectura-frontend.md).

Estado: **Fase 0 implementada y verificada** (falta solo el demo en vivo, que
requiere la `OPENCODE_ZEN_API_KEY`). Ver [README.md](../README.md) para correr.

---

## Fase 0 — Lo básico (objetivo inmediato)

Meta: el flujo completo Tauri → sidecar TS → modelo → herramienta → UI funciona
de punta a punta, aunque sea con un solo agente y una sola herramienta.

### Scaffolding
- [x] Crear el proyecto Tauri v2 con frontend Vite + React + TypeScript.
- [x] Verificar que la ventana abre en dev (`tauri dev`). (En Wayland: usar
      `pnpm app:x11` si el backend nativo falla.)
- [x] Definir estructura de carpetas: `src/` (UI), `sidecar/` (motor),
      `src-tauri/` (cáscara Rust), y a futuro `shared/` (tipos comunes).

### Sidecar (motor en TypeScript)
- [x] Proyecto Node + TS para el sidecar con su `package.json`/`tsconfig`.
- [x] Instalar `openai` y `zod` (el adaptador de OpenCode usa el **SDK de
      OpenAI**; el de Anthropic queda para después). (+ `ws`, `zod-to-json-schema`.)
- [x] **Capa de proveedores** (`providers/`):
  - [x] Definir los tipos normalizados y la interfaz `LlmProvider`
        (incluye `listModels?`) (`providers/types.ts`).
  - [x] Registro/fábrica de proveedores (`providers/registry.ts`).
  - [x] Adaptador genérico **OpenAI-compatible**
        (`providers/openai-compatible.ts`): `stream` (con acumulación de
        `tool_calls` en streaming) + `listModels`.
  - [x] Instanciarlo y registrarlo para **OpenCode Zen**
        (`baseURL: https://opencode.ai/zen/v1`, env `OPENCODE_ZEN_API_KEY`).
  - [x] `listModels`: traer modelos de `GET /zen/v1/models`; **fallback** a
        `https://models.dev/api.json` (`.opencode.models`) si el endpoint no
        responde.
  - [x] Dejar listo el patrón para "agregar otro proveedor = un archivo +
        una línea en el registro".
- [x] Credenciales **por proveedor** desde env / config local
      (`config/secrets.ts`). Para empezar: `OPENCODE_ZEN_API_KEY` (key desde
      `https://opencode.ai/auth`). **Nunca** hardcodearlas ni mandarlas a la UI.
- [x] Selección de proveedor + modelo por defecto (`config/models.ts`)
      (default: proveedor `opencode`).
- [x] Elegir transporte: **WebSocket local** vs **stdio**. → **WebSocket** (puerto
      fijo `8137`, override por `MYAGENT_SIDECAR_PORT`).
- [x] Levantar el transporte y definir el contrato de eventos (`EngineEvent`).
- [x] Implementar el agent loop **agnóstico de proveedor** (`engine/loop.ts`):
      pide turnos vía `LlmProvider.stream`, ejecuta tools y devuelve resultados;
      `stream: true`. (No usar el tool runner específico de Anthropic.)
- [x] **Herramientas `read_file` / `edit_file` estilo _hashline_** (ver
      [herramientas-read-edit.md](./herramientas-read-edit.md)):
  - [x] `edit/hashline/hash.ts`: normalización (CRLF→LF) + `computeFileHash`
        (4 hex).
  - [x] `edit/hashline/snapshot-store.ts`: snapshots por sesión (path →
        versiones), expuesto en el `ctx` de las tools.
  - [x] `read_file`: salida `[PATH#TAG]` + líneas `N:texto`; graba snapshot;
        soporte de rango simple (`41-80`).
  - [x] `edit/hashline/parser.ts` + `apply.ts`: parsear secciones + ops
        (`SWAP`/`DEL`/`INS.PRE`/`INS.POST`/`INS.HEAD`/`INS.TAIL`), aplicar de
        mayor a menor línea.
  - [x] `edit_file`: verificar `hash == TAG` (si no, error claro pidiendo
        re-leer), aplicar, escribir, devolver `[PATH#NUEVOHASH]` + diff.
  - [x] Recortes explícitos del MVP: sin `.BLK`/tree-sitter, sin recuperación
        avanzada, sin archives/sqlite/url en `read`.
- [x] Agregar `write_file` para **crear archivos nuevos** (en hashline, `edit`
      solo modifica existentes; crear es trabajo de `write`).

> Verificado con tests deterministas: `sidecar/smoke-tools.ts` (11/11 ✓:
> round-trip read→edit→write, mismatch de hash, rangos, todas las ops, ruta
> fuera del proyecto) y `sidecar/smoke-ws.mjs` (transporte `ready` + error).

### Cáscara Tauri (Rust mínimo)
- [x] Configurar Tauri para **lanzar el sidecar** Node al iniciar (y matarlo al
      salir; además el sidecar vigila el PID del padre para no quedar huérfano).
- [x] Confirmar que la UI puede conectarse al sidecar (WS) en dev.

### UI (chat mínimo)
- [x] Instalar `zustand` y crear el store de sesión (`state/session.ts`) con
      mensajes, `agentId`, `streaming` y las acciones que consume el transporte.
- [x] `transport/client.ts`: conexión al sidecar + mapear cada `IncomingEvent`
      a la acción correspondiente del store (con reconexión).
- [x] `ChatPanel` + `Composer`: enviar mensaje y ver respuesta en streaming
      (leyendo del store con selectores).
- [x] Render de markdown en los mensajes del asistente.
- [x] Mostrar una tarjeta básica cuando el agente llama a una herramienta
      (`ToolCallCard`). (+ `AgentSwitcher` Plan/Build/E2E, anticipado de Fase 1.)

### Hito de Fase 0
- [ ] **Demo:** pedir por chat "lee el archivo X y resúmelo" y ver al agente
      usar `read_file` y responder en streaming. Luego "crea el archivo Y con
      este contenido" y ver `write_file` funcionando.
      → **Todo cableado y verificado hasta la llamada al LLM**; solo falta
      exportar `OPENCODE_ZEN_API_KEY` y correr `pnpm tauri dev` para el demo en vivo.

---

## Fase 1 — Los 3 agentes

- [ ] `engine/agents.ts`: system prompts de `plan`, `build`, `e2e`.
- [ ] Restringir el **set de herramientas por agente** (Plan = solo lectura).
- [ ] La UI manda `agentId` con cada mensaje; el motor lo usa.
- [ ] `AgentSwitcher` en la UI (Plan | Build | E2E) con indicación visual clara.
- [ ] Agente Plan: emitir evento `plan` (markdown) y render `PlanView` con
      botón **Aprobar**.
- [ ] Agente Build: herramientas `edit_file`, `list_dir`, `search`,
      `run_command`.
- [ ] `run_command` con **confirmación humana** antes de ejecutar.

---

## Fase 2 — UI rica tipo Codex

- [ ] `ProjectPicker`: elegir la carpeta del proyecto activo.
- [ ] Árbol de archivos (lateral).
- [ ] `DiffView`: diffs visuales de archivos editados.
- [ ] `TerminalBlock`: salida en vivo de `run_command`.
- [ ] Resaltado de sintaxis en bloques de código.
- [ ] Historial / lista de sesiones y poder retomarlas.

---

## Fase 3 — E2E real

- [ ] Agente E2E: scaffolding de proyectos nuevos (estructura + deps).
- [ ] Orquestación: E2E invoca internamente Plan y luego Build.
- [ ] Capacidad de **arrancar** la app construida y mostrar su estado.
- [ ] Manejo de proyectos multi-archivo grandes (coherencia, no romper nada).

---

## Fase 4 — Robustez y empaque

- [ ] Política de permisos fina (allow/ask/deny por tipo de acción).
- [ ] Manejo de errores del modelo (rate limit, timeouts) con reintentos.
- [ ] **Empaquetar el sidecar Node** dentro del bundle de Tauri (binario o
      embebido) para que el instalador funcione sin Node externo.
- [ ] Instalador / build de release multiplataforma.
- [ ] Config persistente (API key, preferencias) en almacenamiento local.
- [ ] Paquete `shared/` con los tipos de eventos compartidos UI↔motor.

---

## Decisiones abiertas (resolver pronto)

- [x] **Framework de escritorio:** **Tauri** (no Electrobun). Razón: Tauri es más
      maduro y probado en multiplataforma, incl. Fedora/Linux; Electrobun es un
      v1 joven de un solo mantenedor con Linux enfocado en Ubuntu. El motor se
      mantiene agnóstico del host por si hay que reconsiderar. (Ver
      [arquitectura-backend.md](./arquitectura-backend.md) → "¿Por qué Tauri y
      no Electrobun?".)
- [x] **Proveedor activo:** OpenCode Zen (OpenAI-compatible), vía el SDK de
      OpenAI con `baseURL`. Es el primero en implementarse.
- [ ] **Próximos proveedores:** Anthropic (Claude) con su adaptador propio, y
      OpenAI "real" (= el **mismo** adaptador OpenAI-compatible con otra
      `baseURL`/key). Sirven para confirmar que agregar uno es "un archivo + una
      línea".
- [ ] **Mapeo de capacidades por proveedor:** `thinking`/`effort` son de Claude;
      en el adaptador OpenAI-compatible se ignoran (o se mapean a
      `reasoning_effort` si el modelo lo soporta). Definir la regla general para
      no romper la interfaz normalizada.
- [x] **Transporte:** **WebSocket local** (puerto fijo `8137`, override por
      `MYAGENT_SIDECAR_PORT`). Resuelto en Fase 0.
- [ ] **Empaque del sidecar:** ¿Node embebido, `pkg`/`bun build`, o binario?
      Afecta a Fase 4 pero conviene tenerlo en mente desde el inicio.
- [x] **Estado en la UI:** **Zustand** (un store por dominio; empezar con el de
      sesión). Estado efímero de componente puede quedar en `useState`.
- [ ] **Confirmaciones:** modal vs inline en el chat.
- [ ] ¿Cuándo activar **compaction** para conversaciones largas? (Fase 2-3).

---

## Notas de mantenimiento

- Mantener **sincronizados** los tipos de `EngineEvent` entre `sidecar/` y
  `src/` (idealmente vía `shared/`).
- Convertir fechas relativas a absolutas en estos documentos al actualizarlos.
- Cuando algo de "Decisiones abiertas" se resuelva, moverlo a la fase
  correspondiente y anotar el porqué.
