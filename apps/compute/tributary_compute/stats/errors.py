"""Structured errors: the API shows `{code, field, message}` next to the chart control that caused them."""

import scipy

from tributary_compute import __version__

COMPUTE_VERSION = f"tributary-compute {__version__}; scipy {scipy.__version__}"


class ComputeError(Exception):
    def __init__(self, code: str, field: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field = field
        self.message = message
