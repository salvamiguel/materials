// Ejemplos precargados del playground. Cada uno es un conjunto de ficheros.

export interface Example {
  id: string;
  label: string;
  description: string;
  files: Record<string, string>;
}

const awsProvider = `provider "aws" {
  region = "eu-west-1"

  default_tags {
    tags = {
      Proyecto = "playground"
    }
  }
}
`;

export const EXAMPLES: Example[] = [
  {
    id: 'hola',
    label: 'Primeros pasos',
    description: 'terraform_data, variables y outputs: el ciclo init → plan → apply sin nube.',
    files: {
      'main.tf': `# Bienvenido al playground de Terraform.
# Todo se ejecuta en tu navegador: nadie crea infraestructura real.
#
# 1. Pulsa "init" para instalar los proveedores.
# 2. Pulsa "plan" para ver qué haría Terraform.
# 3. Pulsa "apply" y mira la pestaña "Estado".
# 4. Cambia el valor de "saludo" y vuelve a hacer plan.

variable "saludo" {
  type    = string
  default = "hola"
}

locals {
  mensaje = "\${upper(var.saludo)}, mundo"
}

resource "terraform_data" "ejemplo" {
  input = local.mensaje
}

output "mensaje" {
  value = terraform_data.ejemplo.output
}
`,
    },
  },
  {
    id: 'vpc',
    label: 'Red en AWS: VPC, subredes y EC2',
    description: 'Dependencias implícitas, count, cidrsubnet y un reemplazo forzado al cambiar la AMI.',
    files: {
      'main.tf': `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

${awsProvider}
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true

  tags = {
    Name = "\${var.entorno}-vpc"
  }
}

resource "aws_subnet" "publica" {
  count = var.num_subredes

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  map_public_ip_on_launch = true

  tags = {
    Name = "\${var.entorno}-publica-\${count.index}"
  }
}

resource "aws_security_group" "web" {
  name   = "\${var.entorno}-web"
  vpc_id = aws_vpc.main.id

  dynamic "ingress" {
    for_each = var.puertos
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
}

# Prueba: tras el apply, cambia instance_type (update in-place)
# y luego la ami (destroy and then create replacement).
resource "aws_instance" "web" {
  ami                    = "ami-0c55b159cbfafe1f0"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.publica[0].id
  vpc_security_group_ids = [aws_security_group.web.id]

  tags = {
    Name = "\${var.entorno}-web"
  }
}
`,
      'variables.tf': `variable "entorno" {
  type        = string
  description = "Nombre del entorno"
  default     = "dev"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "num_subredes" {
  type    = number
  default = 2
}

variable "puertos" {
  type    = list(number)
  default = [80, 443]
}
`,
      'outputs.tf': `output "vpc_id" {
  value = aws_vpc.main.id
}

output "subredes" {
  value = aws_subnet.publica[*].cidr_block
}

output "ip_publica" {
  value = aws_instance.web.public_ip
}
`,
    },
  },
  {
    id: 'gcp',
    label: 'Red en GCP: VPC, firewall y Compute Engine',
    description: 'Proveedor google: project/region/zone heredados, labels, IAM y un reemplazo al cambiar la imagen.',
    files: {
      'main.tf': `terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
  }
}

provider "google" {
  project = var.proyecto
  region  = "europe-west1"
  zone    = "europe-west1-b"

  default_labels = {
    curso = "terraform"
  }
}

resource "google_compute_network" "vpc" {
  name                    = "\${var.entorno}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "app" {
  name          = "\${var.entorno}-app"
  ip_cidr_range = cidrsubnet(var.rango, 8, 1)
  network       = google_compute_network.vpc.id
}

resource "google_compute_firewall" "web" {
  name    = "\${var.entorno}-web"
  network = google_compute_network.vpc.name

  dynamic "allow" {
    for_each = var.puertos
    content {
      protocol = "tcp"
      ports    = [tostring(allow.value)]
    }
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web"]
}

resource "google_service_account" "vm" {
  account_id   = "\${var.entorno}-vm"
  display_name = "Cuenta de la VM"
}

resource "google_project_iam_member" "logs" {
  project = var.proyecto
  role    = "roles/logging.logWriter"
  member  = google_service_account.vm.member
}

# Prueba: tras el apply, cambia machine_type (update in-place)
# y luego la imagen (el disco de arranque fuerza un reemplazo).
resource "google_compute_instance" "web" {
  name         = "\${var.entorno}-web"
  machine_type = "e2-micro"
  tags         = ["web"]

  labels = {
    entorno = var.entorno
  }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
    access_config {}
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }
}

resource "google_storage_bucket" "estaticos" {
  name                        = "\${var.proyecto}-\${var.entorno}-estaticos"
  location                    = "EU"
  uniform_bucket_level_access = true
  force_destroy               = true
}
`,
      'variables.tf': `variable "proyecto" {
  type    = string
  default = "mi-proyecto-curso"
}

variable "entorno" {
  type    = string
  default = "dev"
}

variable "rango" {
  type    = string
  default = "10.10.0.0/16"
}

variable "puertos" {
  type    = list(number)
  default = [80, 443]
}
`,
      'outputs.tf': `output "ip_publica" {
  value = google_compute_instance.web.network_interface[0].access_config[0].nat_ip
}

output "cuenta_servicio" {
  value = google_service_account.vm.email
}

output "bucket" {
  value = google_storage_bucket.estaticos.url
}
`,
    },
  },
  {
    id: 's3',
    label: 'S3 con for_each y políticas IAM',
    description: 'for_each sobre un map de objetos, recursos condicionales y un data source que genera JSON.',
    files: {
      'main.tf': `${awsProvider}
variable "buckets" {
  type = map(object({
    versionado = optional(bool, false)
    publico    = optional(bool, false)
  }))
  default = {
    logs    = { versionado = true }
    estatico = { publico = true }
  }
}

resource "random_id" "sufijo" {
  byte_length = 3
}

resource "aws_s3_bucket" "this" {
  for_each = var.buckets
  bucket   = "\${each.key}-\${random_id.sufijo.hex}"
}

# Solo para los buckets con versionado = true
resource "aws_s3_bucket_versioning" "this" {
  for_each = { for nombre, cfg in var.buckets : nombre => cfg if cfg.versionado }

  bucket = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_iam_policy_document" "lectura" {
  statement {
    sid       = "LecturaPublica"
    actions   = ["s3:GetObject"]
    resources = ["\${aws_s3_bucket.this["estatico"].arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "estatico" {
  bucket = aws_s3_bucket.this["estatico"].id
  policy = data.aws_iam_policy_document.lectura.json
}

output "buckets" {
  value = { for nombre, b in aws_s3_bucket.this : nombre => b.bucket }
}
`,
    },
  },
  {
    id: 'modulos',
    label: 'Módulos locales',
    description: 'Un módulo reutilizado dos veces con for_each; las direcciones incluyen module.x["clave"].',
    files: {
      'main.tf': `${awsProvider}
module "web" {
  source   = "./modules/servidor"
  for_each = toset(["frontend", "backend"])

  nombre = each.key
  tipo   = each.key == "backend" ? "t3.small" : "t3.micro"
}

output "ids" {
  value = { for k, m in module.web : k => m.id }
}
`,
      'modules/servidor/main.tf': `variable "nombre" {
  type = string
}

variable "tipo" {
  type    = string
  default = "t3.micro"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

resource "aws_instance" "this" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.tipo

  tags = {
    Name = var.nombre
  }
}

output "id" {
  value = aws_instance.this.id
}
`,
    },
  },
  {
    id: 'variables',
    label: 'Variables, validaciones y tfvars',
    description: 'Tipos complejos, optional(), validation, sensitive y terraform.tfvars.',
    files: {
      'variables.tf': `variable "entorno" {
  type = string

  validation {
    condition     = contains(["dev", "pre", "pro"], var.entorno)
    error_message = "El entorno debe ser dev, pre o pro."
  }
}

variable "servidores" {
  type = map(object({
    cpu    = number
    discos = optional(list(number), [20])
  }))
}

variable "password_bd" {
  type      = string
  sensitive = true
}
`,
      'terraform.tfvars': `# Prueba a poner entorno = "test" y ejecuta plan
entorno = "dev"

servidores = {
  api = { cpu = 2 }
  bd  = { cpu = 4, discos = [50, 100] }
}

password_bd = "cambiame"
`,
      'main.tf': `locals {
  total_cpu   = sum([for s in var.servidores : s.cpu])
  total_disco = sum(flatten([for s in var.servidores : s.discos]))
}

resource "terraform_data" "servidor" {
  for_each = var.servidores
  input = {
    nombre = "\${var.entorno}-\${each.key}"
    cpu    = each.value.cpu
  }
}

resource "terraform_data" "bd" {
  input = var.password_bd
}

output "resumen" {
  value = "\${length(var.servidores)} servidores, \${local.total_cpu} vCPU, \${local.total_disco} GB"
}

# Quita "sensitive = true" y verás el error de Terraform.
output "password" {
  value     = var.password_bd
  sensitive = true
}
`,
    },
  },
  {
    id: 'lifecycle',
    label: 'Ciclo de vida (lifecycle y moved)',
    description: 'create_before_destroy, prevent_destroy, ignore_changes, replace_triggered_by y moved.',
    files: {
      'main.tf': `# Haz apply y luego prueba los cambios sugeridos en los comentarios.

resource "random_pet" "nombre" {
  length = 2
}

# Cambia triggers_replace a "v2": se reemplaza creando primero el nuevo (+/-).
resource "terraform_data" "app" {
  input            = random_pet.nombre.id
  triggers_replace = "v1"

  lifecycle {
    create_before_destroy = true
  }
}

# Se reemplaza cada vez que terraform_data.app cambia.
resource "terraform_data" "cache" {
  input = "cache"

  lifecycle {
    replace_triggered_by = [terraform_data.app]
  }
}

# Cambia input: Terraform lo ignora.
resource "terraform_data" "config" {
  input = "manual"

  lifecycle {
    ignore_changes = [input]
  }
}

# Intenta "destroy": prevent_destroy lo impide.
resource "terraform_data" "critico" {
  input = "no me borres"

  lifecycle {
    prevent_destroy = true
  }
}

# Renombra este recurso a "nuevo" y descomenta el bloque moved:
# Terraform lo mueve en el estado en vez de destruirlo.
resource "terraform_data" "viejo" {
  input = "muévete"
}

# moved {
#   from = terraform_data.viejo
#   to   = terraform_data.nuevo
# }
`,
    },
  },
  {
    id: 'proveedor',
    label: 'Proveedor propio',
    description: 'Define tu propio proveedor en un fichero *.provider.json y úsalo como cualquier otro.',
    files: {
      'pizzeria.provider.json': `{
  "name": "pizzeria",
  "source": "curso/pizzeria",
  "version": "1.0.0",
  "provider": {
    "attributes": {
      "tienda": { "type": "string", "optional": true }
    }
  },
  "resources": {
    "pizzeria_pedido": {
      "attributes": {
        "id":          { "type": "string", "computed": true },
        "tamano":      { "type": "string", "required": true, "force_new": true },
        "ingredientes": { "type": "list(string)", "optional": true },
        "extra_queso": { "type": "bool", "optional": true, "default": false },
        "precio":      { "type": "number", "computed": true },
        "estado":      { "type": "string", "computed": true }
      },
      "mock": {
        "id": "pedido-{digits:6}",
        "precio": 12.5,
        "estado": "en el horno"
      }
    }
  },
  "data_sources": {
    "pizzeria_menu": {
      "attributes": {
        "id":     { "type": "string", "computed": true },
        "pizzas": { "type": "list(string)", "computed": true }
      },
      "mock": {
        "id": "menu",
        "pizzas": ["margarita", "cuatro quesos", "barbacoa"]
      }
    }
  }
}
`,
      'main.tf': `# El proveedor está definido en pizzeria.provider.json:
# atributos required / optional / computed, force_new y valores mock.

terraform {
  required_providers {
    pizzeria = {
      source = "curso/pizzeria"
    }
  }
}

provider "pizzeria" {
  tienda = "centro"
}

data "pizzeria_menu" "hoy" {}

# Cambia ingredientes (update) o tamano (force_new → reemplazo).
resource "pizzeria_pedido" "cena" {
  tamano       = "familiar"
  ingredientes = ["tomate", "mozzarella", data.pizzeria_menu.hoy.pizzas[0]]
}

output "precio" {
  value = pizzeria_pedido.cena.precio
}
`,
    },
  },
  {
    id: 'local',
    label: 'random + local_file',
    description: 'Proveedores sin nube: nombres aleatorios y ficheros locales con templatefile().',
    files: {
      'main.tf': `resource "random_pet" "servidor" {
  length    = 2
  separator = "-"
}

resource "random_password" "admin" {
  length  = 20
  special = false
}

resource "local_file" "inventario" {
  filename = "\${path.module}/inventario.ini"
  content = templatefile("\${path.module}/inventario.tftpl", {
    servidor = random_pet.servidor.id
    puerto   = 8080
  })
}

output "servidor" {
  value = random_pet.servidor.id
}

output "password" {
  value     = random_password.admin.result
  sensitive = true
}
`,
      'inventario.tftpl': `[web]
\${servidor} ansible_port=\${puerto}
`,
    },
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
