terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # State lives in the customer's own S3 bucket (with locking). Supply it at init:
  #   terraform init -backend-config="bucket=<state-bucket>" -backend-config="key=tributary/dev.tfstate" \
  #     -backend-config="region=<region>" -backend-config="use_lockfile=true" -backend-config="encrypt=true"
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Application = "tributary", Environment = var.environment, ManagedBy = "terraform" }
  }
}
