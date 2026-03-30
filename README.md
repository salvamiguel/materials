# Materials — DevOps · Cloud · Automation

Apuntes, demos interactivas y laboratorios para los cursos y módulos que imparto en Másters y charlas.

Publicado en **[salvamiguel.github.io/materials](https://salvamiguel.github.io/materials/)**.

## Contenido

| Módulo | Horas | Contenido |
|--------|-------|-----------|
| Terraform | 20h | IaC, providers, state, módulos, workspaces |
| GitOps | 14h | ArgoCD, pull vs push, rollback, multi-entorno |
| Scripting | 6h | Bash, pipes, cron, error handling, Python vs Bash |

## Desarrollo local

```bash
bun install
bun start
```

## Build

```bash
bun run build
```

Genera contenido estático en el directorio `build`.

## Stack

- [Docusaurus 3](https://docusaurus.io/) con MDX
- TypeScript
- Desplegado con GitHub Pages
