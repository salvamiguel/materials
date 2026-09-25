# tfplay: motor del playground de Terraform

Motor que alimenta la página `/terraform-playground` del sitio. Implementa en Go
la parte de Terraform necesaria para enseñar el ciclo `init → plan → apply →
destroy`, usando las mismas librerías que Terraform (`hashicorp/hcl/v2` y
`zclconf/go-cty`). Se compila a WebAssembly y se ejecuta **solo en el
navegador**, dentro de un Web Worker. No hay backend ni llamadas a ninguna nube.

```
tools/tfplay/
├── engine/            motor (config, grafo, evaluación, plan, apply, render, state)
│   └── testdata/      escenarios "golden" comparados con terraform real
├── cmd/wasm/          bindings JS (globalThis.tfplay) para GOOS=js GOARCH=wasm
├── cmd/tfplay/        CLI nativa para probar el motor: go run ./cmd/tfplay -dir x plan
├── cmd/schemagen/     convierte `terraform providers schema -json` al formato del playground
├── providers/         meta (plantillas mock, defaults) y generate.sh
└── build-wasm.sh      compila a static/tfplay/tfplay.wasm.gz (+ wasm_exec.js)
```

## Qué soporta

- HCL real: expresiones, `for`, splat, condicionales, `dynamic`, ~100 funciones
  (`cidrsubnet`, `templatefile`, `jsonencode`, `try`...), tipos con `optional()`.
- `variable` (validaciones, `sensitive`, `terraform.tfvars`, `*.auto.tfvars`, `-var`),
  `locals`, `output`, `resource`, `data`, módulos locales (`source = "./..."`),
  `count`, `for_each`, `depends_on`, `lifecycle` (`create_before_destroy`,
  `prevent_destroy`, `ignore_changes`, `replace_triggered_by`, pre/postcondition)
  y bloques `moved`.
- Comandos: `init`, `validate`, `fmt`, `plan [-destroy]`, `apply`, `destroy`,
  `output`, `state list`, `state show`, `show`, `graph`, `console`, `providers`.
- Estado `terraform.tfstate` v4 compatible con Terraform (se puede leer con el
  binario real).
- `local_file` y `local_sensitive_file` escriben de verdad en el espacio de
  trabajo: tras `apply` el fichero aparece como una pestaña más y `destroy` lo
  borra. Como el proveedor real, al refrescar trata un fichero editado o borrado
  a mano como un objeto eliminado fuera de Terraform (drift): el siguiente
  `plan` lo avisa y `apply` lo vuelve a crear. No escribe fuera del espacio de
  trabajo ni sobre ficheros de configuración (`*.tf`, `*.tfvars`...).
- Autocompletado del editor: `schema({source, kind?, type?})` devuelve el índice
  de un proveedor cargado (tipos de recursos y data sources, esquema del bloque
  `provider`) o el esquema de un tipo. El análisis del texto lo hace el editor
  (`src/components/playground/terraform/completion/`).

## Proveedores

Los proveedores son genéricos y se describen con JSON:

- `hashicorp/aws`, `hashicorp/google`, `random`, `null` y `local` se generan con
  `providers/generate.sh` a partir del esquema real. Como el JSON de Terraform no
  incluye `ForceNew` ni los valores por defecto, `schemagen` los extrae del código
  fuente de los proveedores AWS y Google (incluidos los helpers de CustomizeDiff
  de Google que rellenan `project`/`region`/`zone`/`deletion_policy`). `providers/meta/*.json` añade plantillas para inventar IDs/ARNs verosímiles
  en el apply (`{hex:16}`, `{region}`, `{attr:bucket}`...).
- `terraform_data` es el proveedor builtin.
- El usuario puede crear los suyos en un fichero `*.provider.json`:

```json
{
  "name": "pizzeria",
  "source": "curso/pizzeria",
  "resources": {
    "pizzeria_pedido": {
      "attributes": {
        "id":     { "type": "string", "computed": true },
        "tamano": { "type": "string", "required": true, "force_new": true },
        "extras": { "type": "list(string)", "optional": true },
        "precio": { "type": "number", "computed": true }
      },
      "mock": { "id": "pedido-{digits:6}", "precio": 12.5 }
    }
  }
}
```

## Desarrollo

```bash
bun run test:wasm     # go test ./... (incluye los golden tests)
bun run build:wasm    # compila el motor a static/tfplay/ (no se versiona)
bun run start         # la página está en /materials/terraform-playground

# CLI nativa, cómoda para depurar
cd tools/tfplay && go run ./cmd/tfplay -dir ./ejemplo init
```

Los golden tests (`engine/testdata/*/step*/expected.txt`) contienen la salida de
`terraform plan` real (1.16 + aws 6.66) sobre los mismos ficheros y el mismo
estado que produce el motor. Para regenerarlos hace falta el binario y un
mirror de proveedores:

```bash
TFPLAY_TERRAFORM=/ruta/terraform TF_CLI_CONFIG_FILE=/ruta/mirror.tfrc \
  go test ./engine -run TestGolden -update
```
