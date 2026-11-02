# CloudFront serves the SPA from the web bucket (Origin Access Control) and forwards /api/* to the ALB with the
# /api prefix removed (as the dev proxy does). SPA routes fall back to /index.html via a viewer-request function,
# so API 403/404 responses are never rewritten.
variable "name" {
  description = "Deployment name prefix."
  type        = string
}

variable "web_bucket_name" {
  description = "SPA bucket name."
  type        = string
}

variable "web_bucket_arn" {
  description = "SPA bucket ARN."
  type        = string
}

variable "web_bucket_regional_domain" {
  description = "SPA bucket regional domain."
  type        = string
}

variable "alb_dns_name" {
  description = "ALB DNS name (API origin)."
  type        = string
}

variable "aliases" {
  description = "Custom domain names (empty: use the cloudfront.net name)."
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "ACM certificate in us-east-1 for the aliases (required when aliases are set)."
  type        = string
  default     = null
}

variable "web_acl_arn" {
  description = "Optional AWS WAF web ACL (scope CLOUDFRONT)."
  type        = string
  default     = null
}

variable "logs_bucket_domain" {
  description = "Bucket domain for CloudFront access logs."
  type        = string
}

# AWS managed policies (IDs are fixed by AWS).
locals {
  caching_optimized       = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  caching_disabled        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  all_viewer_except_host  = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  security_headers_policy = "67f7725c-6f97-4210-82d7-5512b31e9d03"
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa" {
  name    = "${var.name}-spa-routes"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for SPA routes (paths without a file extension)"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (!request.uri.includes('.')) request.uri = '/index.html';
      return request;
    }
  JS
}

resource "aws_cloudfront_function" "api" {
  name    = "${var.name}-strip-api"
  runtime = "cloudfront-js-2.0"
  comment = "Remove the /api prefix before the request reaches the API"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      request.uri = request.uri.replace(/^\/api/, '') || '/';
      return request;
    }
  JS
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.name
  default_root_object = "index.html"
  aliases             = var.aliases
  price_class         = "PriceClass_100"
  web_acl_id          = var.web_acl_arn
  http_version        = "http2and3"

  origin {
    origin_id                = "web"
    domain_name              = var.web_bucket_regional_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = var.alb_dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.caching_optimized
    response_headers_policy_id = local.security_headers_policy
    compress                   = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.caching_disabled
    origin_request_policy_id   = local.all_viewer_except_host
    response_headers_policy_id = local.security_headers_policy
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(var.aliases) == 0
    acm_certificate_arn            = length(var.aliases) == 0 ? null : var.certificate_arn
    ssl_support_method             = length(var.aliases) == 0 ? null : "sni-only"
    minimum_protocol_version       = length(var.aliases) == 0 ? "TLSv1" : "TLSv1.2_2021"
  }

  logging_config {
    bucket          = var.logs_bucket_domain
    prefix          = "cloudfront/"
    include_cookies = false
  }
}

# The SPA bucket only answers this distribution.
data "aws_iam_policy_document" "web" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${var.web_bucket_arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = var.web_bucket_name
  policy = data.aws_iam_policy_document.web.json
}

output "domain_name" {
  description = "CloudFront domain name."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_arn" {
  description = "Distribution ARN."
  value       = aws_cloudfront_distribution.this.arn
}
