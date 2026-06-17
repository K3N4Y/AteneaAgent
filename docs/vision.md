# Visión

## La idea grande

Que MyAgent sea una **app de escritorio capaz de construir un programa completo
end-to-end** — desde la conversación inicial hasta una aplicación funcional con
su propia UI — conversando con el usuario como lo haría Codex, pero como una
herramienta nativa instalable.

El usuario describe lo que quiere; el agente planifica, construye, prueba,
arranca la app y la itera, mostrando en todo momento qué está haciendo.

## Principios

1. **Un solo lenguaje, por ahora: TypeScript.** Toda la lógica (UI y motor) en
   TS. Tauri da el envoltorio de escritorio sin obligarnos a escribir Rust de
   negocio. Esto maximiza velocidad de desarrollo en la etapa temprana.
2. **Transparencia.** El usuario ve el plan antes de la ejecución, ve cada
   herramienta que se invoca y cada comando que corre. Nada de "magia opaca".
3. **Control humano sobre lo irreversible.** Acciones destructivas o externas
   (correr comandos, sobrescribir, instalar) pasan por confirmación.
4. **Escalada de autonomía.** Plan (mira) → Build (modifica) → E2E (crea todo).
   El usuario elige cuánta libertad dar.
5. **Local-first.** El agente trabaja sobre el proyecto del usuario en su
   máquina; solo el modelo es remoto.
6. **Proveedor de IA intercambiable.** El motor no se casa con un proveedor:
   una capa de abstracción permite agregar Claude, OpenAI u otro escribiendo un
   solo adaptador. El usuario podrá elegir proveedor y modelo.

## Los 3 agentes como columna vertebral

La visión se apoya en los tres modos del chat, que maduran en el tiempo:

- **Plan** — de "propone un plan" a un planificador que entiende el repo
  completo, detecta dependencias y riesgos, y produce planes ejecutables.
- **Build** — de "edita archivos" a un agente que itera con tests, se
  autocorrige y mantiene coherencia en proyectos grandes.
- **E2E** — la joya: de "scaffold + código" a orquestar Plan y Build para
  levantar una app entera (estructura, deps, backend, UI, pruebas, arranque) a
  partir de una descripción.

## Horizonte por etapas (alto nivel)

> El detalle accionable vive en [pendiente.md](./pendiente.md). Esto es el mapa,
> no la lista de tareas.

**Etapa 0 — Lo básico.** Tauri abre ventana, sidecar TS vivo, chat con
streaming, un agente con herramientas reales de archivos. *Probar que el flujo
completo funciona end-to-end técnicamente.*

**Etapa 1 — Los 3 agentes.** Separar Plan / Build / E2E con sus system prompts
y permisos. UI con selector de agente y plan aprobable.

**Etapa 2 — UI rica tipo Codex.** Árbol de archivos, diffs visuales, terminal
embebida, tarjetas de herramientas pulidas, historial de sesiones.

**Etapa 3 — E2E de verdad.** El agente E2E construye proyectos nuevos completos
y los arranca, orquestando a Plan y Build internamente.

**Etapa 4 — Robustez y empaque.** Permisos finos, manejo de errores, empaque
del sidecar en el bundle de Tauri, instalador, configuración persistente.

## Más allá (ideas, no compromisos)

- Múltiples proyectos / múltiples sesiones en paralelo.
- Memoria persistente entre sesiones (qué aprendió del repo del usuario).
- Más agentes especializados (revisor de código, escritor de tests, refactor).
- Integraciones (git/GitHub, correr/ver la app embebida).
- Eventual evaluación de migrar el motor de sidecar Node a Rust/Tauri-nativo si
  se busca un binario único — explícitamente **fuera** del alcance temprano.

## Qué *no* es (anti-alcance temprano)

- No es un editor de código completo; es un agente con chat. La edición la hace
  el agente, no un IDE manual.
- No es multiusuario ni un servicio en la nube; es local y de un usuario.
- No mezcla lenguajes en el motor todavía: TS primero, Rust solo cáscara.
