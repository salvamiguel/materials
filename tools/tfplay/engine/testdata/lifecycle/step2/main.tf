resource "random_pet" "p" {
  length = 2
}

resource "terraform_data" "a" {
  input            = "v1"
  triggers_replace = "t2"
  lifecycle {
    create_before_destroy = true
  }
}

resource "terraform_data" "b" {
  input = "changed"
  lifecycle {
    ignore_changes = [input]
  }
}

resource "terraform_data" "c" {
  input = "c1"
  lifecycle {
    replace_triggered_by = [terraform_data.a]
  }
}

moved {
  from = terraform_data.old
  to   = terraform_data.new
}

resource "terraform_data" "new" {
  input = "moved"
}

resource "null_resource" "n" {
  triggers = {
    v = "2"
  }
}

output "pet" {
  value = random_pet.p.id
}
