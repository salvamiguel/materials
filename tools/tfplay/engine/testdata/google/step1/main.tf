terraform {
  required_providers {
    google = { source = "hashicorp/google" }
  }
}
provider "google" {
  project      = "mi-proyecto"
  region       = "europe-west1"
  zone         = "europe-west1-b"
  access_token = "fake"
  default_labels = {
    curso = "terraform"
  }
}
resource "google_compute_network" "vpc" {
  name                    = "vpc-dev"
  auto_create_subnetworks = false
}
resource "google_compute_subnetwork" "sub" {
  name          = "sub-dev"
  ip_cidr_range = "10.10.0.0/24"
  network       = google_compute_network.vpc.id
}
resource "google_compute_firewall" "ssh" {
  name    = "allow-ssh"
  network = google_compute_network.vpc.name
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
  source_ranges = ["0.0.0.0/0"]
}
resource "google_compute_instance" "vm" {
  name         = "vm-dev"
  machine_type = "e2-micro"
  labels = { env = "dev" }
  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.sub.id
    access_config {}
  }
}
resource "google_storage_bucket" "b" {
  name     = "mi-bucket-dev-12345"
  location = "EU"
  uniform_bucket_level_access = true
}
resource "google_service_account" "sa" {
  account_id   = "app-sa"
  display_name = "App"
}
resource "google_project_iam_member" "viewer" {
  project = "mi-proyecto"
  role    = "roles/viewer"
  member  = "serviceAccount:${google_service_account.sa.email}"
}
output "ip" { value = google_compute_instance.vm.network_interface[0].access_config[0].nat_ip }
