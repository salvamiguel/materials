package engine

import (
	"strings"
	"testing"
)

type session struct {
	t         *testing.T
	en        *Engine
	installed []string
	files     map[string]string
	state     string
}

func newSession(t *testing.T, files map[string]string) *session {
	en, installed := loadEngine(t)
	return &session{t: t, en: en, installed: installed, files: files}
}

func (s *session) run(cmd string, args ...string) Response {
	s.t.Helper()
	resp := s.en.Run(Request{Command: cmd, Args: args, Files: s.files, State: s.state, Installed: s.installed})
	if resp.State != nil {
		s.state = *resp.State
	}
	return resp
}

func mustContain(t *testing.T, out string, want ...string) {
	t.Helper()
	for _, w := range want {
		if !strings.Contains(out, w) {
			t.Errorf("output does not contain %q:\n%s", w, out)
		}
	}
}

func TestApplyIsIdempotent(t *testing.T) {
	s := newSession(t, map[string]string{"main.tf": `
provider "aws" { region = "eu-south-2" }
resource "aws_vpc" "v" {
  cidr_block = "10.0.0.0/16"
  tags = { Name = "x" }
}
resource "aws_subnet" "s" {
  for_each   = toset(["a", "b"])
  vpc_id     = aws_vpc.v.id
  cidr_block = cidrsubnet(aws_vpc.v.cidr_block, 8, each.key == "a" ? 1 : 2)
}
resource "aws_security_group" "sg" {
  vpc_id = aws_vpc.v.id
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
output "subnets" { value = { for k, s in aws_subnet.s : k => s.id } }
`})
	r := s.run("apply")
	if r.ExitCode != 0 {
		t.Fatal(r.Output)
	}
	mustContain(t, r.Output, "Apply complete! Resources: 4 added, 0 changed, 0 destroyed.", `subnets = {`, "eu-south-2")
	r = s.run("plan")
	mustContain(t, r.Output, "No changes. Your infrastructure matches the configuration.")
	r = s.run("state_list")
	mustContain(t, r.Output, "aws_security_group.sg\n", `aws_subnet.s["a"]`, "aws_vpc.v\n")
	r = s.run("state_show", "aws_vpc.v")
	mustContain(t, r.Output, `# aws_vpc.v:`, `resource "aws_vpc" "v" {`, `cidr_block`, `"10.0.0.0/16"`)
	r = s.run("output", "subnets")
	mustContain(t, r.Output, `"a" = "subnet-0`)
	r = s.run("destroy")
	mustContain(t, r.Output, "Destroy complete! Resources: 4 destroyed.")
	if strings.Contains(s.state, `"type": "aws_vpc"`) {
		t.Errorf("state still has resources after destroy:\n%s", s.state)
	}
}

func TestInitRequired(t *testing.T) {
	en, _ := loadEngine(t)
	files := map[string]string{"main.tf": `resource "aws_s3_bucket" "b" {}`}
	r := en.Run(Request{Command: "plan", Files: files})
	mustContain(t, r.Output, "Inconsistent dependency lock file", "terraform init")
	r = en.Run(Request{Command: "init", Files: files})
	mustContain(t, r.Output, "Installing hashicorp/aws v", "Terraform has been successfully initialized!")
	if len(r.Installed) != 1 || r.Installed[0] != "hashicorp/aws" {
		t.Errorf("installed = %v", r.Installed)
	}
	if !strings.Contains(r.Files[".terraform.lock.hcl"], `provider "registry.terraform.io/hashicorp/aws"`) {
		t.Errorf("missing lock file: %v", r.Files)
	}
	r = en.Run(Request{Command: "init", Files: map[string]string{"main.tf": `resource "google_storage_bucket" "b" {}`}})
	mustContain(t, r.Output, "Failed to query available provider packages", "hashicorp/google")
}

func TestValidate(t *testing.T) {
	s := newSession(t, map[string]string{"main.tf": `
variable "n" { type = number }
resource "aws_instance" "i" {
  count         = var.n
  ami           = "ami-1"
  instance_type = "t3.micro"
}
`})
	r := s.run("validate")
	mustContain(t, r.Output, "Success! The configuration is valid.")
	s.files["main.tf"] += `
resource "aws_instance" "bad" {
  ami  = "ami-1"
  arn  = "x"
  typo = 1
}
resource "aws_instanc" "x" {}
`
	r = s.run("validate")
	mustContain(t, r.Output, `Unsupported argument`, `An argument named "typo" is not expected here.`,
		`An argument named "arn" is not expected here.`, `Invalid resource type`, `Did you mean "aws_instance"?`)
}

func TestErrors(t *testing.T) {
	cases := map[string]struct{ src, want string }{
		"variable validation": {`variable "env" {
  default = "qa"
  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "env must be dev or prod."
  }
}`, `var.env is "qa"`},
		"sensitive output": {`variable "pw" {
  default   = "x"
  sensitive = true
}
output "pw" { value = var.pw }`, "Output refers to sensitive values"},
		"unknown count": {`resource "random_integer" "n" {
  min = 1
  max = 3
}
resource "terraform_data" "d" {
  count = random_integer.n.result
}`, "Invalid count argument"},
		"for_each list": {`resource "terraform_data" "d" {
  for_each = ["a"]
}`, "must be a map, or set of strings"},
		"cycle": {`locals {
  a = local.b
  b = local.a
}`, "Cycle: local.a, local.b"},
		"missing var": {`variable "x" {}`, "No value for required variable"},
		"remote module": {`module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
}`, "Only local modules"},
		"function error": {`output "o" { value = cidrsubnet("10.0.0.0/16", 8, 300) }`, "subnet numbered 300"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			s := newSession(t, map[string]string{"main.tf": c.src})
			r := s.run("plan")
			if r.ExitCode == 0 {
				t.Fatalf("expected failure:\n%s", r.Output)
			}
			mustContain(t, r.Output, c.want)
		})
	}
}

func TestPreventDestroy(t *testing.T) {
	s := newSession(t, map[string]string{"main.tf": `
resource "terraform_data" "d" {
  lifecycle { prevent_destroy = true }
}`})
	s.run("apply")
	r := s.run("destroy")
	mustContain(t, r.Output, "Instance cannot be destroyed", "lifecycle.prevent_destroy")
}

func TestDeferredDataRead(t *testing.T) {
	s := newSession(t, map[string]string{"main.tf": `
provider "aws" { region = "eu-west-1" }
resource "aws_s3_bucket" "b" { bucket = "x" }
data "aws_iam_policy_document" "p" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.b.arn}/*"]
  }
}
data "aws_availability_zones" "az" {}
output "azs" { value = data.aws_availability_zones.az.names }
`})
	r := s.run("plan")
	mustContain(t, r.Output, "data.aws_availability_zones.az: Read complete",
		"# data.aws_iam_policy_document.p will be read during apply",
		"# (config refers to values not yet known)", ` <= data "aws_iam_policy_document" "p" {`,
		`+ azs = [`, `"eu-west-1a",`)
	r = s.run("apply")
	mustContain(t, r.Output, `azs = tolist([`)
	if !strings.Contains(s.state, `arn:aws:s3:::x/*`) {
		t.Errorf("policy document not rendered in state")
	}
}

func TestCustomProvider(t *testing.T) {
	en, installed := loadEngine(t)
	files := map[string]string{
		"pizza.provider.json": `{
  "name": "pizza",
  "source": "curso/pizza",
  "version": "1.0.0",
  "resources": {
    "pizza_order": {
      "attributes": {
        "id":       {"type": "string", "computed": true},
        "size":     {"type": "string", "required": true, "force_new": true},
        "toppings": {"type": "list(string)", "optional": true},
        "extra":    {"type": "bool", "optional": true, "default": false},
        "price":    {"type": "number", "computed": true}
      },
      "mock": {"id": "order-{digits:6}", "price": 12.5}
    }
  }
}`,
		"main.tf": `
terraform {
  required_providers {
    pizza = { source = "curso/pizza" }
  }
}
resource "pizza_order" "o" {
  size     = "L"
  toppings = ["tomate", "queso"]
}
output "price" { value = pizza_order.o.price }
`,
	}
	r := en.Run(Request{Command: "init", Files: files, Installed: installed})
	mustContain(t, r.Output, "Installing curso/pizza v1.0.0", "loaded from pizza.provider.json")
	installed = append(installed, r.Installed...)
	r = en.Run(Request{Command: "apply", Files: files, Installed: installed})
	mustContain(t, r.Output, "+ extra    = false", "pizza_order.o: Creation complete", "[id=order-", "price = 12.5")
	state := *r.State
	files["main.tf"] = strings.Replace(files["main.tf"], `"L"`, `"XL"`, 1)
	r = en.Run(Request{Command: "plan", Files: files, Installed: installed, State: state})
	mustContain(t, r.Output, `~ size     = "L" -> "XL" # forces replacement`, "Plan: 1 to add, 0 to change, 1 to destroy.")
}

func TestConsoleAndFmt(t *testing.T) {
	s := newSession(t, map[string]string{"main.tf": "locals {\nx=[1,2,3]\n    name = \"a\"\n}\n"})
	r := s.run("console", `{ for i in local.x : "k${i}" => i * 2 }`)
	mustContain(t, r.Output, `"k1" = 2`, `"k3" = 6`)
	r = s.run("console", `cidrsubnets("10.0.0.0/16", 4, 4, 8)`)
	mustContain(t, r.Output, `"10.0.0.0/20"`, `"10.0.16.0/20"`, `"10.0.32.0/24"`)
	r = s.run("fmt")
	mustContain(t, r.Output, "main.tf")
	if !strings.Contains(r.Files["main.tf"], "  x    = [1, 2, 3]") {
		t.Errorf("fmt result:\n%s", r.Files["main.tf"])
	}
}

func TestCountShrinkAndModules(t *testing.T) {
	s := newSession(t, map[string]string{
		"main.tf": `
module "app" {
  source = "./modules/app"
  count  = 2
  name   = "app-${count.index}"
}
output "names" { value = module.app[*].name }
`,
		"modules/app/main.tf": `
variable "name" { type = string }
resource "terraform_data" "this" { input = var.name }
output "name" { value = terraform_data.this.output }
`,
	})
	r := s.run("apply")
	mustContain(t, r.Output, "module.app[1].terraform_data.this: Creation complete", `"app-1",`)
	s.files["main.tf"] = strings.Replace(s.files["main.tf"], "count  = 2", "count  = 1", 1)
	r = s.run("plan")
	mustContain(t, r.Output, "# module.app[1].terraform_data.this will be destroyed",
		"# (because module.app[1] is not in configuration)", "Plan: 0 to add, 0 to change, 1 to destroy.")
}
