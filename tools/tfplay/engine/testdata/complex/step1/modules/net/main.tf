variable "cidr" { type = string }
variable "ports" { type = list(number) }
resource "aws_vpc" "this" {
  cidr_block = var.cidr
}
resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = aws_vpc.this.id
  dynamic "ingress" {
    for_each = var.ports
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
}
output "sg_id" { value = aws_security_group.web.id }
