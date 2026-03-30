# Variable Playground — Design Spec

**Date:** 2026-03-30
**Approach:** Separated parser/UI (Approach B)
**Stack:** React 19, TypeScript, inline styles, DemoWrapper

---

## Overview

An interactive HCL playground where students write Terraform variable declarations, locals, resources, and outputs in a free-text editor. The playground parses the HCL in real-time, validates types, resolves references, and displays the resolved resources plus a simulated `terraform plan` output.

---

## Architecture

Two files:

| File | Responsibility |
|------|---------------|
| `src/components/demos/terraform/hclParser.ts` | Parse HCL subset → AST, validate types/references, evaluate expressions, generate plan text. Pure logic, no React. |
| `src/components/demos/terraform/VariablePlayground.tsx` | Editor UI, diagnostics panel, output panel with tabs, presets. Uses DemoWrapper. |

Pipeline: `source string` → `parse()` → `HclBlock[]` → `validate()` → `Diagnostic[]` → `evaluate()` → `EvalResult`

---

## HCL Parser — Subset Scope

### Supported Blocks

- `variable "name" { type = <type>; default = <value>; description = "..." }`
- `locals { key = <expr>; ... }`
- `resource "type" "name" { attr = <expr>; ... }`
- `output "name" { value = <expr> }`

### Supported Types

- Primitives: `string`, `number`, `bool`
- Collections: `list(type)`, `map(type)`
- Structural: `object({ key = type, ... })`

### Supported Expressions

- Literals: `"string"`, `42`, `true`, `["a", "b"]`, `{ key = "val" }`
- References: `var.name`, `local.name`
- Interpolation: `"Hello ${var.name}"`

### AST Types

```typescript
// --- Types ---
type HclType =
  | { kind: 'primitive'; name: 'string' | 'number' | 'bool' }
  | { kind: 'list'; element: HclType }
  | { kind: 'map'; element: HclType }
  | { kind: 'object'; fields: Record<string, HclType> };

// --- Blocks ---
interface VariableBlock {
  blockType: 'variable';
  name: string;
  type?: HclType;
  default?: HclValue;
  description?: string;
  line: number;
}

interface LocalsBlock {
  blockType: 'locals';
  assignments: Record<string, HclExpr>;
  line: number;
}

interface ResourceBlock {
  blockType: 'resource';
  resourceType: string;
  name: string;
  attributes: Record<string, HclExpr>;
  line: number;
}

interface OutputBlock {
  blockType: 'output';
  name: string;
  value: HclExpr;
  line: number;
}

type HclBlock = VariableBlock | LocalsBlock | ResourceBlock | OutputBlock;

// --- Expressions ---
type HclExpr =
  | { kind: 'literal'; value: HclValue }
  | { kind: 'ref'; path: string[] }
  | { kind: 'interpolation'; parts: (string | HclExpr)[] }
  | { kind: 'list'; elements: HclExpr[] }
  | { kind: 'map'; entries: Record<string, HclExpr> };

type HclValue = string | number | boolean | HclValue[] | Record<string, HclValue>;

// --- Diagnostics ---
interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  line: number;
  column?: number;
}

// --- Evaluation ---
interface ResolvedResource {
  type: string;
  name: string;
  attributes: Record<string, HclValue>;
}

interface EvalResult {
  resolvedResources: ResolvedResource[];
  outputs: Record<string, HclValue>;
  planText: string;
}
```

### Public API

```typescript
// parse source → blocks or syntax errors
function parse(source: string): { blocks: HclBlock[]; errors: Diagnostic[] };

// validate blocks → type/reference errors
function validate(blocks: HclBlock[]): Diagnostic[];

// evaluate blocks → resolved resources + plan text
function evaluate(blocks: HclBlock[]): EvalResult;
```

---

## Validation Rules

| Error | Example | Message |
|-------|---------|---------|
| Variable without type | `variable "x" {}` | `Variable "x" no tiene tipo definido` |
| Type mismatch on default | `type = number`, `default = "hola"` | `El default de "x" es string pero se espera number` |
| Undefined variable | `var.foo` without `variable "foo"` | `Variable "foo" no está definida` |
| Undefined local | `local.bar` without `locals { bar = ... }` | `Local "bar" no está definido` |
| Syntax error | `variable {` without name | `Error de sintaxis en línea 3: se esperaba nombre de variable` |
| List element type mismatch | `type = list(number)`, `default = ["a"]` | `Elemento de lista: se espera number, encontrado string` |
| Map value type mismatch | `type = map(string)`, `default = { k = 3 }` | `Valor de map: se espera string, encontrado number` |
| Object missing field | `type = object({ name = string })`, `default = {}` | `Falta campo "name" en object` |

Numbers inside interpolation (`"${var.count}"`) are implicitly converted to string (matching Terraform behavior).

Validation runs in real-time with 300ms debounce as the student types.

---

## Evaluation & Plan Output

When the code has no errors, evaluation produces:

**Resolved resources:** Each resource with expressions substituted by concrete values.

**Simulated plan:** Formatted output mimicking `terraform plan`:

```
Terraform will perform the following actions:

  # local_file.example will be created
  + resource "local_file" "example" {
      + filename = "/tmp/hello.txt"
      + content  = "Archivo: Hola mundo"
    }

Plan: 1 to add, 0 to change, 0 to destroy.

Outputs:
  resultado = "Hola mundo"
```

The plan output is displayed with line-by-line animation (80ms per line, matching TerraformPlanSim pattern) and semantic coloring (`+` in green).

---

## UI Layout

Wrapped in `DemoWrapper` with title "Playground de Variables" and badge "INTERACTIVE DEMO".

### Two-panel layout

- **Left panel (60%):** HCL editor
- **Right panel (40%):** Output with two tabs: "Resuelto" and "Plan"

### Left Panel — Editor

- Textarea with line numbers (monospace, one-dark background)
- Error lines highlighted in red with inline message below the offending line
- Diagnostics panel below the textarea listing all errors/warnings with severity icon and line number
- Clicking a diagnostic scrolls to that line

### Right Panel — Output

- Tab bar: "Resuelto" | "Plan"
- **Resuelto tab:** Shows each resolved resource as formatted HCL with values substituted. Syntax-colored.
- **Plan tab:** Shows the simulated `terraform plan` output with line-by-line animation and green `+` coloring. Re-generates when the debounced parse/validate cycle produces zero errors (i.e., code transitions to valid state or valid code changes).

### Presets

Dropdown above the editor with predefined examples that load into the textarea:

| Preset | Content |
|--------|---------|
| Tipos básicos | string, number, bool variables + resource using them |
| Listas y maps | list(string), map(number) with resource |
| Object | object({ name = string, port = number }) with resource |
| Interpolación | Variables combined with string interpolation |
| Error de tipo | Intentional type mismatch to demonstrate validation |
| Vacío | Empty editor |

### Responsive

- Below 768px: panels stack vertically (editor on top, output below)
- Touch-friendly textarea

### Styling

- Inline styles following TerraformPlanSim pattern
- Editor: one-dark palette (#282c34 bg, #abb2bf text, #e06c75 errors, #98c379 strings, #61afef keywords)
- CSS variables from design system for DemoWrapper integration
- `prefers-reduced-motion`: disable line-by-line animation

---

## Integration

The playground will be used in `docs/terraform/teoria/variables.mdx`:

```mdx
import VariablePlayground from '@site/src/components/demos/terraform/VariablePlayground';

<VariablePlayground />
```

No props needed — the component is self-contained with its own presets and state.
