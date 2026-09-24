resource "random_pet" "p" {
  length = 2
}

resource "terraform_data" "a" {
  input            = "v1"
  triggers_replace = "t1"
  lifecycle {
    create_before_destroy = true
  }
}

resource "terraform_data" "b" {
  input = random_pet.p.id
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

resource "terraform_data" "old" {
  input = "moved"
}

resource "null_resource" "n" {
  triggers = {
    v = "1"
  }
}

output "pet" {
  value = random_pet.p.id
}
