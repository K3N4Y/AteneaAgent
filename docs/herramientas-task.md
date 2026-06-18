# Herramienta `task` — subagentes

> Spec de diseño (todavía **no implementada**). El "porqué" de alto nivel está en
> [vision.md](./vision.md); el motor y el contrato de eventos, en
> [arquitectura-backend.md](./arquitectura-backend.md); las otras tools del MVP,
> en [herramientas-read-edit.md](./herramientas-read-edit.md). Esta tool es
> candidata a **Fase 4/5** (ver [pendiente.md](./pendiente.md)).

## Qué resuelve

Hoy MyAgent tiene **tres perfiles** (`plan`, `build`, `e2e`) que elige el usuario
o que se rutean por fase (`server.ts`). Son roles, no jerarquía: un agente **no
puede delegar en otro**. Las únicas 8 tools (`read_file`, `list_dir`, `search`,
`submit_plan`, `write_file`, `edit_file`, `run_command`, `start_app`) operan
todas en el mismo hilo y el mismo contexto.

`task` agrega lo que hacen OpenCode y Claude Code: que un agente **lance
subagentes** con su propio contexto aislado, opcionalmente en paralelo, y reciba
de vuelta sólo un **resumen**. Dos ganancias concretas:

- **Aislamiento de contexto:** una exploración que lee 20 archivos quema su
  presupuesto en el subagente; al padre vuelven 10 líneas de hallazgos, no los 20
  archivos. El contexto del padre se mantiene chico.
- **Paralelismo:** varias búsquedas/lecturas independientes corren a la vez en
  vez de una tras otra.

## Idea central (por qué es barato)

`runAgent()` (`engine/loop.ts`) **ya es re-entrante y agnóstico de proveedor**:
recibe `{ providerId, model, system, messages, tools, ctx, signal }` y un `emit`,
y corre el bucle hasta terminar. Un subagente es, literalmente, **otra llamada a
`runAgent`** con:

- un `messages` **nuevo**, sembrado con la descripción de la tarea;
- el system prompt y el toolset del `subagent_type` elegido;
- un `SnapshotStore` **propio** (aislamiento de ediciones);
- el **mismo** `projectRoot`, `provider`, `model` y `signal` que el padre.

El texto final del subagente es el `output` del `ToolResult` que vuelve al padre.
No hay máquina de orquestación nueva: es el patrón "ponytail" de Fase 3 (E2E =
dos `runAgent` normales) llevado a tools.

## Contrato de la tool

```ts
// tools/task.ts
const oneTask = z.object({
  subagent_type: z.enum(["explore", "build"]).describe(
    "explore: sólo lectura (read_file/list_dir/search), para investigar y resumir. " +
    "build: lectura + escritura + run_command, para implementar una sub-tarea acotada.",
  ),
  description: z.string().min(1).describe(
    "Instrucción AUTÓNOMA y completa para el subagente: qué investigar o hacer y " +
    "qué devolver. El subagente NO ve la conversación del padre, sólo este texto.",
  ),
});

const schema = z.object({
  tasks: z.array(oneTask).min(1).max(MAX_SUBAGENTS_PER_CALL).describe(
    "Una o más sub-tareas. Si pasás varias, corren EN PARALELO y se devuelven " +
    "todas juntas. Usá varias sólo cuando son independientes entre sí.",
  ),
});
```

- **Input:** un array `tasks`. Un elemento = un subagente serial; varios = fan-out
  en paralelo (ver [Paralelismo](#paralelismo--fan-out)).
- **Output (`ToolResult.output`):** los resúmenes concatenados, uno por subagente,
  con encabezado `### Subagente N (explore): …`. `isError` es `true` sólo si
  **todos** fallan; si alguno falla, su bloque lo dice y el resto vuelve igual.
- **Descripción de la tool (lo que ve el modelo):** debe dejar claro que el
  subagente arranca **sin contexto** (sólo `description`), que devuelve **un
  resumen** (no su transcript completo), y que `explore` es el default seguro;
  `build` se reserva para sub-tareas acotadas.

## `subagent_type`: perfiles disponibles

Mismos prompts/toolsets que ya existen, con dos perfiles nuevos pensados para
delegación. Viven junto a los actuales (`engine/agents.ts`, `tools/registry.ts`):

| `subagent_type` | Toolset | Para qué | Confirmación |
|---|---|---|---|
| `explore` | `READ_ONLY` (`read_file`, `list_dir`, `search`) | Investigar y resumir. **Sin escritura ni shell** → seguro para paralelizar. | No pide |
| `build`   | `READ_ONLY` + `WRITE` (`write_file`, `edit_file`, `run_command`, `start_app`) | Implementar una sub-tarea acotada. | Igual que el padre |

Notas de diseño:

- **`explore` es nuevo** y es el caso principal (el 80% del valor: fan-out de
  investigación read-only). Su toolset es `READ_ONLY` sin `submit_plan` (un
  subagente no presenta planes a la UI; devuelve texto).
- **`build` reusa** el toolset de `build`/`e2e` tal cual.
- **Ningún subagente recibe la tool `task`** (regla de recursión; ver
  [Límites](#recursión-y-límites)).
- El system prompt del subagente debe terminar con la convención: *"Tu mensaje
  final ES el valor que se devuelve a quien te invocó. Devolvé hallazgos/resultado
  concretos y concisos, no una respuesta de chat."*

## Integración con el motor

### 1) Extender `ToolContext` (un campo, igual que `confirm`/`onPlan`)

Las tools sólo reciben `ctx`. Agregamos la **capacidad de spawnear**, que el
`server.ts` cablea (es quien tiene `provider`, `model`, `emit` y `signal`):

```ts
// tools/types.ts → ToolContext
/**
 * Lanza un subagente con contexto aislado y devuelve su resumen. Lo cablea el
 * server (cierra sobre provider/model/emit/signal). Si no está provista (tests
 * sin orquestador), `task` responde error y NO corre nada.
 */
spawnSubagent?: (req: {
  subagentType: "explore" | "build";
  prompt: string;
  parentToolId: string;   // id de la tool-call `task` que lo originó (para la UI)
}) => Promise<{ text: string; isError: boolean }>;
```

La tool `task` queda trivial: valida que exista `ctx.spawnSubagent`, mapea cada
sub-tarea a una llamada y combina los resultados. **No toca `emit` ni el provider
directamente** (misma separación que el resto de tools).

### 2) Cablear en `server.ts`

Donde hoy se arma el `ctx` (`server.ts`, el bloque `base.ctx`), se agrega:

```ts
spawnSubagent: async ({ subagentType, prompt, parentToolId }) => {
  const subMessages: LlmMessage[] = [{ role: "user", content: [{ type: "text", text: prompt }] }];
  // emit "marcado": estampa parentToolId para que la UI lo trate como anidado
  // y NO lo mezcle en el transcript principal (ver Surfacing).
  const scopedEmit = (ev) => emit({ ...ev, parentToolId });
  await runAgent({
    providerId: activeProviderId,
    model: activeModel,
    system: subagentPromptFor(subagentType),
    messages: subMessages,
    tools: subagentToolsFor(subagentType),   // nunca incluye `task`
    ctx: {
      projectRoot: session.projectRoot,
      snapshots: new SnapshotStore(),        // aislado del padre
      confirm,                               // se reusa el del padre (ver Permisos)
      trackProcess,                          // start_app del subagente igual se limpia
      // sin onPlan, sin spawnSubagent → profundidad 1
    },
    signal: controller.signal,               // abort del padre corta al hijo
  }, scopedEmit);
  return { text: finalAssistantText(subMessages), isError: /* hubo error en el stream */ };
},
```

### 3) Extraer el resumen

Tras `runAgent`, el último mensaje `assistant` de `subMessages` contiene las
partes `text`. `finalAssistantText()` las concatena. No hace falta interceptar el
stream: el historial ya quedó completo (mismo invariante que usa la UI al retomar
sesiones en `client.ts → toLlmHistory`).

## Paralelismo / fan-out

- **Dentro de un `task`:** si `tasks` trae varios elementos, la tool los corre con
  `Promise.all` sobre `ctx.spawnSubagent`. Es el único lugar con concurrencia, y
  está acotado a esta tool — el bucle principal (`loop.ts`) sigue ejecutando sus
  tool-calls **en serie** (no se toca, evita carreras en `write_file`/snapshots).
- **Caveat de escritura:** subagentes `build` en paralelo comparten `projectRoot`.
  Cada uno tiene su `SnapshotStore`, pero dos que editen el **mismo archivo** a la
  vez se pisan (el hashline detecta el hash viejo y falla, no corrompe — pero es
  trabajo perdido). **Recomendación v1:** paralelizá sólo `explore`; corré `build`
  de a uno. La descripción de la tool lo dice explícitamente.
- **Cap de fan-out:** `MAX_SUBAGENTS_PER_CALL` (p. ej. 4) en `config/limits.ts`,
  para no abrir 50 conexiones al proveedor de una.

## Recursión y límites

- **Profundidad = 1.** Los subagentes **no** reciben la tool `task` (su `ctx` no
  trae `spawnSubagent`, y su toolset no la incluye). Garantía estructural, no por
  prompt — misma lógica que "Plan no escribe porque no tiene la tool" en
  `tools/registry.ts`. Esto basta para evitar recursión infinita.
- **Presupuesto por subagente:** cada `runAgent` hereda `MAX_TURNS` y el
  cortafuegos anti-bucle (`MAX_IDENTICAL_TOOL_TURNS`) de `config/limits.ts`. Un
  subagente colgado se corta solo sin afectar al padre.
- **Costo:** N subagentes = N conversaciones con el modelo. La ganancia es que el
  **contexto del padre** sólo crece por el resumen. Documentar en la descripción
  que `task` es para trabajo que vale el costo (investigación amplia, fan-out),
  no para una sola lectura (para eso está `read_file` directo).

## Permisos / confirmación

- Un subagente `build` que llame `run_command`/`start_app` dispara el **mismo**
  flujo de confirmación (`ctx.confirm` → `permission_request`/`permission_response`,
  cableado en `server.ts`). Se reusa tal cual.
- **Carrera conocida:** el store de la UI guarda **una** `pendingPermission`
  (`state/session.ts`); si dos subagentes `build` piden confirmación a la vez, la
  UI sólo muestra la última. Por eso v1 recomienda **paralelo = sólo `explore`**
  (read-only, nunca pide confirmación). Una cola de confirmaciones es trabajo
  futuro (Fase 4, "Política de permisos fina").

## Abort

El `controller.signal` del padre se pasa a cada subagente. `loop.ts` ya chequea
`opts.signal?.aborted` al inicio de cada turno, así que un `abort` desde la UI
corta padre **y** subagentes. Los `start_app` que haya levantado un subagente
quedan registrados vía `trackProcess` y se matan en `ws.close` como cualquier
otro (no se dejan huérfanos).

## Surfacing en la UI

**Sub-transcript anidado y en vivo** (estilo Claude Code): cada subagente se
muestra indentado bajo la tarjeta del `task`, con sus tool-calls apareciendo a
medida que las hace. Logs sigue registrando todo para diagnóstico.

- El subagente corre con un `emit` "marcado" que estampa `parentToolId` (= su
  índice dentro del `task`) en cada evento. El cliente (`transport/client.ts →
  dispatch`) **enruta por ese campo**:
  - eventos **con** `parentToolId` → al **panel de Logs** (que ya registra todo)
    **y** al sub-transcript del subagente: `tool_call`/`tool_result` se anidan en
    `UiToolCall.subagents[index].toolCalls` vía `addSubToolCall`/
    `resolveSubToolCall`. **No** tocan el transcript principal del padre. El
    `assistant_delta`/`thinking_delta` del subagente quedan sólo en Logs (su texto
    final ya vuelve como el resumen del `task`).
  - eventos **sin** `parentToolId` → como hoy.
- La `ToolCallCard` del `task` muestra: el fan-out (cuántos subagentes y de qué
  tipo) en la cabecera, un bloque indentado por subagente con su badge + conteo de
  pasos + sus tool-cards anidadas (reusa la propia `ToolCallCard`, profundidad 1),
  y al final el **resumen** devuelto (el `tool_result.output`).
- El sub-transcript se persiste con la sesión (es parte del `UiToolCall`), así que
  al retomar una sesión guardada se vuelve a ver anidado.

## Cambios de protocolo (no rompen)

Un **único** campo opcional nuevo, en ambos espejos (`engine/events.ts` y
`src/transport/protocol.ts` — recordar la nota de "mantener sincronizados"):

```ts
// agregar a tool_call, tool_result, assistant_delta y thinking_delta:
parentToolId?: string;
```

Al ser opcional, los clientes/sesiones viejos lo ignoran. No hay mensajes nuevos
en el sentido UI→motor: `task` viaja dentro del flujo normal de `user_message`.

## Recortes conscientes (ponytail)

- **Sin streaming anidado en la UI** en v1: el subagente es "caja negra + resumen"
  para el transcript; su detalle vive en Logs. (Mismo recorte que `TerminalBlock`
  y `start_app` en fases previas.)
- **Paralelo = sólo `explore`** por la carrera de confirmaciones y los conflictos
  de escritura. `build` paralelo se habilita cuando exista cola de permisos +
  aislamiento de escritura (¿worktree por subagente?).
- **Profundidad 1**, sin árboles de subagentes. Suficiente para fan-out de
  investigación y delegación simple.
- **Sin presupuesto de tokens compartido** entre subagentes: cada uno corre con
  los límites por-turno existentes. Un tope global de costo es Fase 4.

## Plan de pruebas

Deterministas, sin LLM (como `sidecar/smoke-tools.ts`), **stubeando**
`ctx.spawnSubagent`:

1. **Sin `spawnSubagent`** (tests/headless) → `task` devuelve error y no corre
   nada.
2. **Un task** → llama a `spawnSubagent` una vez con el `prompt` correcto y
   devuelve su `text` como output.
3. **Varios tasks** → se llaman todos (paralelo), el output combina los N
   resúmenes en orden, `isError` sólo si fallan todos.
4. **Registro:** aserción de que `subagentToolsFor("explore"|"build")` **no**
   incluye `task` (garantía de profundidad 1).
5. **Fan-out cap:** un array más largo que `MAX_SUBAGENTS_PER_CALL` es rechazado
   por el schema Zod.

Integración real (subagente que de verdad llama al modelo) queda para el **demo
en vivo** con `OPENCODE_ZEN_API_KEY`, igual que el resto del proyecto.

## Archivos a tocar (checklist de implementación)

- [ ] `sidecar/tools/types.ts` — agregar `spawnSubagent?` a `ToolContext`.
- [ ] `sidecar/tools/task.ts` — la tool nueva (schema + `run` que combina).
- [ ] `sidecar/engine/agents.ts` — prompts `explore` y (opcional) ajuste de
      `build` para uso como subagente; helper `subagentPromptFor`.
- [ ] `sidecar/tools/registry.ts` — `subagentToolsFor`; agregar `task` al toolset
      de `build`/`e2e` (los que **pueden** delegar); `ALL_TOOLS` += `taskTool`.
- [ ] `sidecar/server.ts` — cablear `ctx.spawnSubagent` (provider/model/emit/
      signal); `scopedEmit` con `parentToolId`; `finalAssistantText`.
- [ ] `sidecar/config/limits.ts` — `MAX_SUBAGENTS_PER_CALL`.
- [ ] `sidecar/engine/events.ts` + `src/transport/protocol.ts` — campo
      `parentToolId?` (sincronizado).
- [ ] `src/transport/client.ts` — `dispatch` enruta los `tool_call`/`tool_result`
      con `parentToolId` al sub-transcript del subagente (`addSubToolCall`/
      `resolveSubToolCall`) además de Logs.
- [ ] `src/state/session.ts` — `UiToolCall.subagents` + acciones que anidan las
      tool-calls del subagente.
- [ ] `src/components/ToolCallCard.tsx` — render del sub-transcript anidado y del
      resumen del `task`.
- [ ] `sidecar/smoke-tools.ts` — los 5 casos de arriba.
- [ ] **Rebuild del sidecar** (`dist/`) — la cáscara Rust corre `dist/server.js`.
