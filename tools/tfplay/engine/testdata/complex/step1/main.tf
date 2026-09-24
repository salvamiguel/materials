terraform {
  required_providers {
    aws    = { source = "hashicorp/aws" }
    random = { source = "hashicorp/random" }
  }
}
provider "aws" {
  region                      = "eu-west-1"
  access_key                  = "AKIAFAKE"
  secret_key                  = "fake"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}
variable "buckets" {
  type = map(object({
    versioning = optional(bool, false)
    tags       = optional(map(string), {})
  }))
  default = {
    logs   = { versioning = true }
    assets = { tags = { Team = "web" } }
  }
}
variable "db_password" {
  type      = string
  sensitive = true
  default   = "s3cr3t!"
}
locals {
  ports = [80, 443]
}
resource "random_pet" "suffix" {
  length = 2
}
resource "aws_s3_bucket" "this" {
  for_each = var.buckets
  bucket   = "${each.key}-${random_pet.suffix.id}"
  tags     = merge({ Name = each.key }, each.value.tags)
}
resource "aws_s3_bucket_versioning" "this" {
  for_each = { for k, v in var.buckets : k => v if v.versioning }
  bucket   = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}
module "net" {
  source = "./modules/net"
  cidr   = "10.20.0.0/16"
  ports  = local.ports
}
data "aws_iam_policy_document" "read" {
  statement {
    sid       = "Read"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = ["arn:aws:s3:::static-bucket/*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::123456789012:root"]
    }
  }
}
resource "aws_iam_policy" "read" {
  name   = "read-policy"
  policy = data.aws_iam_policy_document.read.json
}
resource "terraform_data" "pw" {
  input = var.db_password
}
output "bucket_arns" {
  value = { for k, b in aws_s3_bucket.this : k => b.arn }
}
output "sg_id" {
  value = module.net.sg_id
}
output "pw" {
  value     = terraform_data.pw.output
  sensitive = true
}
