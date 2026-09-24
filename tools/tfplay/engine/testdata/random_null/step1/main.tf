resource "random_pet" "a" {}
resource "random_id" "b" {
  byte_length = 4
}
resource "random_string" "c" {
  length = 12
}
resource "random_password" "d" {
  length = 16
}
resource "random_integer" "e" {
  min = 1
  max = 9
}
resource "random_uuid" "f" {}
resource "random_shuffle" "g" {
  input = ["a", "b", "c"]
}
resource "null_resource" "h" {
  triggers = { a = "b" }
}
resource "terraform_data" "i" {
  input = "x"
}
