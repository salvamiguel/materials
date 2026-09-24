resource "local_file" "f" {
  filename = "${path.module}/hola.txt"
  content  = "hola"
}
