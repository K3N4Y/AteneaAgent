# Pendiente (backlog y plan por fases)

> Lista accionable. El "porqué" y el mapa de alto nivel están en
> [vision.md](./vision.md); las decisiones técnicas, en
> [arquitectura-backend.md](./arquitectura-backend.md) y
> [arquitectura-frontend.md](./arquitectura-frontend.md).

Estado: **Fases 0, 1, 2 y 3 implementadas y verificadas** (falta solo el demo en
vivo, que requiere la `OPENCODE_ZEN_API_KEY`). Ver [README.md](../README.md)
para correr.

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

- [x] `engine/agents.ts`: system prompts de `plan`, `build`, `e2e` (Plan usa
      `submit_plan`; Build/E2E describen list_dir/search/run_command).
- [x] Restringir el **set de herramientas por agente** (`tools/registry.ts`):
      Plan = sólo lectura + `submit_plan`; Build/E2E = + write/edit/run_command.
- [x] La UI manda `agentId` con cada mensaje; el motor lo usa (server.ts elige
      prompt y set de tools según `agentId`).
- [x] `AgentSwitcher` en la UI (Plan | Build | E2E) con indicación visual clara
      (color por modo + hint visible del modo activo).
- [x] Agente Plan: emitir evento `plan` (markdown, vía tool `submit_plan` →
      `ctx.onPlan`) y render `PlanView` con botón **Aprobar** (aprobar conmuta a
      Build y le pide implementar).
- [x] Agente Build: herramientas `edit_file`, `list_dir`, `search`,
      `run_command` (+ write_file/read_file heredadas de Fase 0).
- [x] `run_command` con **confirmación humana** antes de ejecutar (eventos
      `permission_request`/`permission_response`; `ctx.confirm` cableado en
      server.ts; `PermissionCard` inline en el chat).

> Verificado con tests deterministas: `sidecar/smoke-tools.ts` (21/21 ✓: suma
> list_dir, search —substring/regex/acotado—, run_command —confirma/rechaza/sin
> confirm— y submit_plan). Typecheck + build de ambos lados (sidecar `tsc`, UI
> `tsc && vite build`) en verde.

---

## Fase 2 — UI rica tipo Codex ✅

- [x] `ProjectPicker`: elegir la carpeta del proyecto activo. Diálogo nativo
      (`@tauri-apps/plugin-dialog`; permiso `dialog:default`, plugin en
      `lib.rs`), con fallback a `prompt()` fuera de Tauri. La carpeta se manda
      como `projectPath` en cada `user_message` y persiste en localStorage; el
      default es el `cwd` del sidecar (lo manda en el evento `ready`).
- [x] Árbol de archivos (lateral): `FileTree` con **carga perezosa** (cada
      carpeta pide sus hijos al sidecar vía mensaje `list_dir` → `dir_listing`,
      sin pasar por el LLM). Oculta ruido (`.git`, `node_modules`, `target`,
      `dist`). Clic en archivo inserta su ruta en el composer.
- [x] `DiffView`: diffs visuales de archivos editados. Colorea el diff que
      `edit_file`/`write_file` ya devuelven en su `output` (`DiffView.tsx`,
      cableado en `ToolCallCard`).
- [x] `TerminalBlock`: salida de `run_command` con estilo de terminal
      (`TerminalBlock.tsx`). **Recorte:** no es streaming en vivo — el backend
      captura todo y devuelve al final; la salida viva pide un evento de chunks
      desde el sidecar (agregar cuando haga falta ver builds largos).
- [x] Resaltado de sintaxis en bloques de código (`rehype-highlight` en
      `react-markdown` + tema compacto hljs en `App.css`).
- [x] Historial / lista de sesiones y poder retomarlas: persistidas en
      localStorage (`state/history.ts`, cap 30), listadas en el rail lateral
      (pestaña Sesiones). Retomar reconstruye el historial normalizado
      (`LlmMessage[]`, incluidas las tool calls) y lo manda al sidecar con
      `load_history`. **Recorte:** localStorage (no disco); los snapshots de
      `edit_file` no se restauran (el modelo re-lee antes de editar).

> Verificado: `tsc` (sidecar) + `tsc && vite build` (UI) + `cargo check` en
> verde. Checks deterministas: `classify` de Diff/Terminal (12/12) y la
> invariante `tool_use`↔`tool_result` de la reconstrucción de historial. Smoke:
> `smoke-tools` OK; transporte `ready`(+`cwd`)+`error` sin key OK; handler
> `list_dir` responde y oculta `node_modules`.

---

## Fase 3 — E2E real ✅

- [x] Agente E2E: scaffolding de proyectos nuevos (estructura + deps). Sin tool
      nueva: el E2E ya tiene `write_file` + `run_command`; el scaffolding es
      `run_command` con `npm create …`/`npm init`/`npm install` + `write_file`.
      Se reforzó el system prompt de E2E para guiarlo.
- [x] Orquestación: E2E es **Plan→Build con gate humano**, sin máquina de
      orquestación. El primer turno propone con el prompt/tools de `plan` (sólo
      lectura + `submit_plan`) y se detiene al emitir el plan; la UI lo muestra con
      botón **Aprobar**. Al aprobar, la UI reenvía el `user_message` con `approve`
      y `server.ts` corre la fase de CONSTRUCCIÓN con el prompt/tools de `e2e`
      (write/edit/run/start_app) sobre el **mismo historial**. El ruteo por fase es
      una línea en `server.ts` (`msg.agentId === "e2e" && !msg.approve ? "plan" :
      msg.agentId`). ponytail: dos turnos de `runAgent` normales, cero estado nuevo.
- [x] Capacidad de **arrancar** la app construida y mostrar su estado. Tool nueva
      `start_app` (`tools/start-app.ts`): spawnea un proceso de **fondo** de larga
      duración (servidor de dev) sin bloquear — `run_command` no sirve porque
      bloquea hasta que el proceso termina/vence el timeout, y un dev server no
      termina. Espera una cadena `ready` o un grace period, devuelve estado +
      primeros logs, deja el proceso vivo. Mismo gate de confirmación que
      `run_command`. El server registra el proceso (`ctx.trackProcess`) y lo mata
      en `ws.close` para no dejar huérfanos. La UI lo muestra con `TerminalBlock`.
- [x] Manejo de proyectos multi-archivo grandes (coherencia, no romper nada).
      Cubierto por el modelo **hashline** existente (read-before-edit + verificación
      por hash: si el archivo cambió, `edit_file` falla y obliga a re-leer — ese
      es el guard de "no romper nada") + guía en el prompt (pasos pequeños,
      build/tests tras cada set de cambios, coherencia de imports/tipos/rutas).
      Sin máquina nueva.

> Verificado: `tsc` (sidecar) + `tsc && vite build` (UI) en verde; `dist` del
> sidecar reconstruido. Smoke determinista `smoke-tools.ts` **26/26** (suma 4
> casos de `start_app`: corre y queda vivo + se rastrea, proceso que termina
> solo → error, corte por cadena `ready`, sin confirm → denegado). El allowlist
> de env de subprocesos se unificó en `tools/proc-env.ts` (lo comparten
> `run_command` y `start_app`).

### Recortes conscientes (ponytail)
- `start_app` **no** hace streaming en vivo de logs: devuelve los primeros y deja
  el proceso corriendo. Agregar un evento de chunks cuando haga falta ver el log
  vivo de un server (mismo recorte que `TerminalBlock` en Fase 2).
- E2E **espera aprobación humana** del plan: propone, se detiene y construye solo
  al aprobar (gate). Plan y construcción quedan en **dos turnos/burbujas**
  separados (no se mezclan). Si en el futuro se quiere un modo de máxima
  autonomía sin gate, sería un toggle que saltee el freno (`approve` implícito).
- `start_app` mata las apps en `ws.close`; un crash duro del sidecar
  (`process.exit` del watchdog) podría dejar hijos. Suficiente para el demo;
  endurecer en Fase 4 (empaque/robustez) si hace falta.

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
- [x] **Confirmaciones:** **inline en el chat** (`PermissionCard` al pie de la
      conversación). Razón: mantiene el comando visible en contexto junto a la
      tool-card que lo disparó y no roba el foco como un modal. Resuelto en Fase 1.
- [ ] ¿Cuándo activar **compaction** para conversaciones largas? (Fase 2-3).

---

## Notas de mantenimiento

- Mantener **sincronizados** los tipos de `EngineEvent` entre `sidecar/` y
  `src/` (idealmente vía `shared/`).
- Convertir fechas relativas a absolutas en estos documentos al actualizarlos.
- Cuando algo de "Decisiones abiertas" se resuelva, moverlo a la fase
  correspondiente y anotar el porqué.
