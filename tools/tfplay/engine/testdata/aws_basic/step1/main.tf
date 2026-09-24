terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}
provider "aws" {
  region                      = "eu-west-1"
  access_key                  = "AKIAFAKE"
  secret_key                  = "fake"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  default_tags {
    tags = { Project = "demo" }
  }
}
variable "env" {
  type    = string
  default = "dev"
}
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags = { Name = "main-${var.env}-v2" }
}
resource "aws_subnet" "public" {
  count      = 2
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
}
resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.large"
  subnet_id     = aws_subnet.public[0].id
  tags = { Name = "web" }
}
resource "aws_s3_bucket" "b" {
  bucket = "my-bucket-${var.env}"
}
output "vpc_id" { value = aws_vpc.main.id }
output "env" { value = var.env }
