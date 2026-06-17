# Arquitectura del frontend (UI tipo Codex)

> La UI corre dentro del **webview de Tauri**, escrita en **TypeScript +
> React + Vite**. Su trabajo es: conversar con el usuario, mostrar el stream
> del agente en vivo, y dejar ver qué archivos toca y qué comandos corre.

## Objetivo de diseño

Una experiencia tipo **Codex**: un chat central donde el usuario habla con el
agente, con render rico de lo que el agente hace (llamadas a herramientas,
diffs, salida de terminal) y un selector para cambiar entre los 3 agentes
(Plan / Build / E2E).

## Stack

- **TypeScript + React** (componentes).
- **Vite** como bundler/dev server (es el default de Tauri para frontend web).
- **Tauri webview** como contenedor de la app.
- **Estado: Zustand.** Un store por dominio (empezando por el de sesión). Estado
  local efímero de un componente puede seguir en `useState`; lo compartido vive
  en Zustand. Sin sobre-ingeniería: nada de Redux/boilerplate.

## Layout de la pantalla

```
┌───────────────────────────────────────────────────────────┐
│  Barra superior:  [Proyecto ▾]   [Agente: Plan|Build|E2E]  │
├──────────────┬────────────────────────────────────────────┤
│              │                                            │
│  Árbol de    │   Chat (stream de mensajes)                │
│  archivos    │   - mensajes usuario / asistente           │
│  (opcional   │   - tarjetas de tool_call / tool_result    │
│   al inicio) │   - diffs de archivos                      │
│              │   - bloque de salida de terminal           │
│              │                                            │
│              ├────────────────────────────────────────────┤
│              │   Input + botón enviar + (confirmar acción) │
└──────────────┴────────────────────────────────────────────┘
```

Para "lo básico" basta la **columna del chat + input**. El árbol de archivos,
diffs y terminal se agregan después (ver [pendiente.md](./pendiente.md)).

## Componentes

```
src/
├── App.tsx
├── transport/
│   └── client.ts          # conexión al sidecar (WS) + envío/recepción
├── state/
│   └── session.ts         # store de Zustand: mensajes, agente activo, proyecto, estado UI
├── components/
│   ├── ChatPanel.tsx      # lista de mensajes + auto-scroll
│   ├── MessageBubble.tsx  # mensaje de usuario / asistente (markdown)
│   ├── ToolCallCard.tsx   # render de una llamada a herramienta + su resultado
│   ├── DiffView.tsx       # diff de un archivo editado (después)
│   ├── TerminalBlock.tsx  # salida de run_command (después)
│   ├── PlanView.tsx       # plan del agente Plan, con "Aprobar"
│   ├── AgentSwitcher.tsx  # Plan | Build | E2E
│   ├── ProjectPicker.tsx  # elegir carpeta del proyecto
│   └── Composer.tsx       # input de texto + enviar + confirmaciones
└── main.tsx
```

## Cliente de transporte (`transport/client.ts`)

Espejo del contrato del motor (ver
[arquitectura-backend.md](./arquitectura-backend.md)). La UI:

1. Se conecta al WebSocket local del sidecar.
2. Envía eventos del usuario: `{ type: "user_message", text, agentId, projectPath }`.
3. Recibe el stream de eventos del motor y actualiza el estado.

```ts
// Tipos espejo de EngineEvent del backend
type IncomingEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: string; isError: boolean }
  | { type: "plan"; markdown: string }
  | { type: "done"; usage?: unknown }
  | { type: "error"; message: string };

ws.onmessage = (e) => dispatch(JSON.parse(e.data) as IncomingEvent);
```

> **Importante:** los tipos de eventos deben mantenerse **sincronizados** entre
> frontend y backend. A futuro conviene un paquete `shared/` con esos tipos
> importado por ambos lados (monorepo TS).

## Store de Zustand (`state/session.ts`)

Un store con el estado compartido + las **acciones** que el cliente de
transporte invoca al recibir cada evento del motor. El streaming muta el store y
React re-renderiza solo.

```ts
import { create } from "zustand";

interface SessionState {
  agentId: "plan" | "build" | "e2e";
  projectPath?: string;
  messages: Message[];        // usuario / asistente, con tool calls embebidas
  streaming: boolean;         // bloquea el input mientras el agente trabaja

  // acciones (las llama transport/client.ts con cada IncomingEvent)
  setAgent(id: SessionState["agentId"]): void;
  sendUserMessage(text: string): void;     // agrega msg + manda al sidecar
  appendAssistantDelta(text: string): void; // concatena al último msg asistente
  addToolCall(name: string, input: unknown): void;
  resolveToolCall(name: string, output: string, isError: boolean): void;
  finishTurn(): void;                       // streaming = false
}

export const useSession = create<SessionState>((set, get) => ({
  agentId: "plan",
  messages: [],
  streaming: false,
  setAgent: (agentId) => set({ agentId }),
  appendAssistantDelta: (text) => set((s) => ({ /* … actualiza último msg */ })),
  // …
}));
```

- Los componentes leen con selectores (`useSession((s) => s.messages)`) para
  re-render mínimo.
- `transport/client.ts` mapea cada `IncomingEvent` a la acción correspondiente
  (en vez del `dispatch` genérico del ejemplo anterior).
- A futuro, separar en varios stores por dominio si crece (sesión, proyecto,
  ajustes); por ahora uno solo alcanza.

## Manejo del streaming

- `assistant_delta` → se va concatenando al último mensaje del asistente para
  el efecto "escribiendo en vivo".
- `tool_call` → se agrega una **tarjeta** al hilo mostrando qué herramienta se
  llamó y con qué argumentos.
- `tool_result` → se completa esa tarjeta con el resultado (o el error).
- `plan` → render especial con botón **Aprobar** (dispara que el agente Build
  continúe).
- `done` → se desbloquea el input.

## Confirmaciones de acciones

Cuando el agente quiere hacer algo difícil de revertir (correr un comando,
sobrescribir un archivo), el motor pausa y la UI muestra un **modal/inline de
confirmación** ("¿Ejecutar `npm install`?  [Permitir] [Rechazar]"). Esto evita
sorpresas y es parte del diseño desde el inicio.

## Selector de agente

`AgentSwitcher` cambia `agentId` (plan/build/e2e) en el estado y lo manda con
cada mensaje. El backend usa ese id para elegir el system prompt y el set de
herramientas. Visualmente conviene dejar claro el modo activo (color/etiqueta),
sobre todo para distinguir **Plan** (solo lectura) de los que sí modifican.

## Render de markdown y código

Los mensajes del asistente vienen en markdown (con bloques de código). Usar un
renderer de markdown + resaltado de sintaxis. Para diffs, un componente
dedicado (`DiffView`) que coloree adiciones/eliminaciones.

## Lo mínimo para la primera etapa

1. `ChatPanel` + `Composer` funcionando.
2. `transport/client.ts` conectado al sidecar.
3. Streaming de texto del asistente visible.
4. `AgentSwitcher` (aunque al principio los 3 hagan casi lo mismo).

Todo lo demás (árbol de archivos, diffs ricos, terminal embebida, plan con
aprobación) es incremental.
